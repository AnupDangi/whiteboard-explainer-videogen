# Multi-head Latent Attention: the long-context cache problem and its compression answer

This document is a fixed evaluation fixture for long-form document teaching runs.
It is organized into three chapters that build on one canonical mental model:
a transformer language model that must attend over everything it has read so far.
Chapter one establishes why that model needs a memory. Chapter two shows the
compression mechanism. Chapter three examines the trade-offs. Every teaching run
over this source must keep one canonical identity for each concept across all
three chapters, must not re-introduce the same idea under a new name, and must
carry the mental model forward between chapters instead of resetting the canvas.

## Chapter one — why autoregressive attention needs a memory at all

A language model predicts the next token from every token it has already seen.
To do that, each token is first converted into a vector embedding, a list of
numbers that positions the token somewhere in a semantic space where similar
meanings sit near each other. But knowing what a token means in isolation is
not enough. The word "bank" means something different next to "river" than it
does next to "loan". Attention is the mechanism that lets each token gather
context from the other tokens and adjust its representation accordingly.

The attention operation works with three projections of each token. The query
is what the current token is looking for. The key is what each earlier token
offers to be matched against. The value is the information each earlier token
contributes once it is selected. For a new token, the model compares its query
against the keys of all previous tokens, converts the match scores into
weights, and mixes the values according to those scores. This comparison is the
core computation of the entire model, and it happens for every generated token.

Here is where the cost appears. To answer the query of the newest token, the
model needs the keys and values of every earlier token. Those vectors cannot be
discarded after use, because the next token may need them again. So the model
keeps them in a growing workspace called the key-value cache. The cache is not
the text itself; it is the processed numerical form of the text that attention
actually reads. Every extra token in the context adds a fixed number of vectors
to this cache, and every attention step must read all of them.

The cost grows in two dimensions at once. The compute cost of attention grows
with the square of the context length, because every token attends to every
other token. The memory cost of the cache grows linearly but without bound:
a long document, a long conversation, or an agent working over many tool
results accumulates tens of thousands of cached vectors per layer. Multiply by
the number of attention heads, which read different aspects of the sequence in
parallel, and by the number of layers, each of which keeps its own cache, and
the workspace becomes one of the largest single consumers of memory during
generation. Serving one user with a hundred-thousand-token context can occupy
gigabytes of accelerator memory for cached vectors alone.

This has a direct systemic consequence. The number of users a machine can
serve at once is bounded not by the compute of attention but by how many key
value caches fit in memory simultaneously. Batch size, and therefore hardware
utilization, is capped by cache size. The cache also dominates the cost of
moving context between machines: when a model is served across many devices,
the cache has to be split, transferred, or recomputed, and every one of those
strategies costs time or bandwidth. The cache, not the arithmetic of attention,
is the wall that long contexts run into.

A useful mental model at this point is a librarian who, while answering your
question, must keep a personal note card for every sentence you have ever read
to them. The note cards are not the book. They are a processed summary of each
sentence in a form that lets the librarian find relevant ones instantly. The
longer the conversation, the more cards must be kept on the desk at once, and
the desk, not the librarian's reading speed, becomes the bottleneck.

To make the scale concrete, consider the arithmetic of a mid-sized deployment.
A single attention layer with a few dozen heads keeps, for every historical
token, one key and one value per head. At a typical head dimension and two
bytes per component, each historical token costs kilobytes per layer, and a
model with dozens of layers multiplies that by the layer count. A
hundred-thousand-token context then holds hundreds of megabytes per user per
layer group, and a cluster serving dozens of long-context sessions at once
must either hold terabytes of cache or turn users away. This is why providers
meter context so carefully and why long-context pricing historically tracked
memory rather than compute.

The cache also shapes latency in a subtler way. Attention reads the entire
cache for every generated token, so a cache that spills out of fast memory
into slower tiers slows every single step of generation, not just the first.
Prefetching helps, but the working set of attention is the whole cache by
definition, so the effective bandwidth demand scales with context length even
when the model weights themselves stay small and hot. Engineers describing
this situation often say the cache is the thing that grows while everything
else stays put, which is exactly why its size is the first number a serving
team optimizes.

This framing also explains why the problem is structural rather than
incidental. Truncating the cache loses information; the model would forget the
beginning of the document. Recomputing the cache from text on demand costs an
extra pass over the whole context for every query. Moving the cache off memory
onto disk trades one bottleneck for a slower one. The system needs a way to
keep all of the information in a form that takes far less space. That is the
problem the next chapter addresses.

## Chapter two — the latent compression mechanism

Multi-head latent attention, usually abbreviated MLA, answers the cache
problem by not storing keys and values in their full form. Instead of keeping
every key and every value vector for every token and every head, MLA compresses
each token's key-value material into one short vector called a latent
representation. The word latent is chosen deliberately: the information needed
to reconstruct the keys and values is present in the vector, but in a packed,
compressed form that is much smaller than the originals.

The mechanism works in two phases. In the compression phase, when a token
enters the cache, its full key and value material is projected down into the
short latent vector, and only the latent is stored. In the decompression
phase, when attention actually needs to read a token, the stored latent is
expanded back up into the key and value vectors the attention computation
expects. Compression and decompression are learned linear maps, so the model
is trained end to end to pack the information that matters into the latent and
to unpack it faithfully.

The reason this can work is that keys and values are not arbitrary vectors.
Across a trained model, the joint key-value material of a token lies on a much
lower-dimensional surface than the raw concatenation suggests. The latent
vector learns to live on that surface. Most of the apparent size of the cache
is redundancy between heads and between the key and value views of the same
token, and a learned compression can remove exactly that redundancy while the
reconstruction step restores whatever attention needs at read time.

The payoff is a much smaller workspace. Instead of storing per-head keys and
values for every historical token, the serving system stores one compact
latent per token. For a fixed memory budget, the context a deployment can
hold grows by a large factor. Equivalently, for a fixed context, far more
concurrent users fit on the same hardware, because each user's cache footprint
shrinks by the compression ratio. During decoding, attention over compressed
latents reconstructs only what the current query needs, and the reconstruction
is a small matrix product against the latent, which is cheap compared with
reading the uncompressed store.

Two details matter for correctness. First, the reconstruction is not a lookup:
the model never stored the original keys and values, so attention operates on
the reconstructed approximation. Training makes this approximation faithful
enough that model quality does not measurably degrade, which is an empirical
property learned during training rather than a guarantee. Second, the new
token's own query, key, and value also flow through the same compression, so
the newly written cache entry is a latent from the start. Nothing ever has to
be compressed retroactively; compression happens at write time.

A second mental model for this phase is a library with limited shelf space.
Instead of shelving every full book, the library stores a dense microfilm of
each volume. When a patron asks about a topic, the librarian reprints exactly
the pages that are relevant from the dense roll. The card catalog still grows
one entry per sentence, but each entry is tiny, and the reconstruction step
turns the tiny entries back into full pages whenever they are needed.

This is also where the mechanism connects back to the chapter one problem. The
note cards that could not fit on the desk are replaced by a microfilm roll that
holds the same information in a fraction of the space. The librarian still
answers with the same care, but the desk never overflows, and the librarian can
serve many more patrons at once because each patron's archive is small.

## Chapter three — trade-offs, history, and when compression is the right tool

The compression buys capacity, and the cost is paid in computation and in
approximation. Decompression adds a small matrix multiplication to every
attention read, and while it is far cheaper than storing and reading full
caches at scale, it is not free. The learned compression is also a bet: if the
training distribution shifts, or if a deployment stresses token types the
compressor saw rarely, the reconstruction error can rise in ways that are hard
to see without evaluation. This is why serving systems treat the compression
ratio and the reconstruction error together, as one measured quantity.

There is also a systems trade. Compressed latents change the shape of the
memory problem: full caches are large and simple; latents are small and
require an unpack step fused into attention. Hardware that handles the fused
path well, such as accelerators with efficient small matrix multiplications,
benefits most. On hardware where that fusion is awkward, part of the memory
savings is paid back in scheduling complexity. The engineering decision is
therefore not only about memory capacity but about the whole serving pipeline.

Historically, the size of the attention workspace motivated a family of
approximations: sliding windows that keep only recent tokens, sparse patterns
that read a subset of positions, and quantized caches that store numbers with
fewer bits. Each trades recall for space in a different way. The latent
approach is distinctive because it keeps every token rather than a subset, and
compresses the representation instead of the text. It coexists with those
alternatives: a window plus latents, or sparse reads over latents, are both
consistent combinations, and real systems can layer them.

For long documents, the decisive question is what the model must be able to
recall. If the task needs a fact stated once at the very beginning, a compressed
archive must preserve it exactly, because there is no second chance to read
the original text. If the task is local, the reconstruction burden is small.
The compression ratio, the reconstruction error, and the recall requirements of
the workload together decide whether the trade is favorable. The fixture
lesson a teacher should land on is the pipeline itself: tokens enter, their
key-value material is compressed to latents at write time, attention reads by
reconstructing from latents, and the serving system fits far more context per
gigabyte than the uncompressed design. Everything in this chapter is a
consequence of that one pipeline and its measured trade-offs.
