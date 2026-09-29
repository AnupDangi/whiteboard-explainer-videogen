import unittest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from service import MultimodalMonitor, UsageTracker, _embedding_ready, _index_status, _positive_int, _query_status, _single_attempt, index_store_completion_problems


class EmbeddingReadinessTests(unittest.TestCase):
    def test_openrouter_key_is_ready_for_embedding_fallback(self):
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": "test-key"}, clear=True):
            self.assertTrue(_embedding_ready())

    def test_explicit_embedding_key_is_ready_without_openrouter_key(self):
        with patch.dict("os.environ", {"EMBEDDINGS_API_KEY": "test-key"}, clear=True):
            self.assertTrue(_embedding_ready())

    def test_embedding_is_not_ready_when_neither_key_is_set(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(_embedding_ready())


class RagLimitsAndAccountingTests(unittest.TestCase):
    def test_timeout_settings_are_bounded_and_invalid_values_use_default(self):
        with patch.dict("os.environ", {"RAG_REQUEST_TIMEOUT_SECONDS": "999"}, clear=True):
            self.assertEqual(_positive_int("RAG_REQUEST_TIMEOUT_SECONDS", 35, 120), 120)
        with patch.dict("os.environ", {"RAG_REQUEST_TIMEOUT_SECONDS": "invalid"}, clear=True):
            self.assertEqual(_positive_int("RAG_REQUEST_TIMEOUT_SECONDS", 35, 120), 35)

    def test_usage_tracker_sums_only_provider_reported_usage_and_marks_cost_unknown(self):
        usage = UsageTracker()
        usage.add_usage({"prompt_tokens": 23, "completion_tokens": 7, "total_tokens": 30})
        usage.add_usage({"prompt_tokens": 11, "total_tokens": 11})
        report = usage.snapshot()
        self.assertEqual(report["providerReportedUsageResponses"], 2)
        self.assertEqual(report["promptTokens"], 34)
        self.assertEqual(report["completionTokens"], 7)
        self.assertEqual(report["totalTokens"], 41)
        self.assertIsNone(report["costUsd"])
        self.assertIn("unknown", report["costStatus"])

    def test_provider_timeout_is_partial_even_if_library_returned_from_insert(self):
        monitor = MultimodalMonitor(expected=1)
        monitor.completed = 1
        usage = UsageTracker()
        usage.begin_call()
        usage.fail_call("llm", TimeoutError("bounded request timed out"))
        self.assertEqual(_index_status(monitor, usage), "partial")

    def test_swallowed_multimodal_item_failure_cannot_be_marked_complete(self):
        monitor = MultimodalMonitor(expected=2)
        monitor.completed = 1
        monitor.failed = 1
        self.assertEqual(_index_status(monitor, UsageTracker()), "partial")

    def test_complete_status_requires_every_multimodal_item_and_no_provider_failure(self):
        monitor = MultimodalMonitor(expected=2)
        monitor.completed = 2
        self.assertEqual(_index_status(monitor, UsageTracker()), "complete")

    def test_query_provider_timeout_is_partial_not_completed(self):
        usage = UsageTracker()
        usage.begin_call()
        usage.fail_call("llm", TimeoutError("query request timed out"))
        self.assertEqual(_query_status(usage), "partial")

    def test_light_rag_retry_wrapper_is_bypassed_for_one_attempt(self):
        async def underlying():
            return "one attempt"

        async def decorated(*args, **kwargs):
            raise AssertionError("decorator wrapper should not be invoked")

        decorated.__wrapped__ = underlying
        self.assertIs(_single_attempt(decorated), underlying)
        self.assertIs(_single_attempt(underlying), underlying)

    def test_processed_status_with_orphaned_full_doc_is_not_a_complete_index(self):
        status = {"status": "processed", "chunks_count": 1, "chunks_list": ["chunk-1"]}
        problems = index_store_completion_problems(status, [], [])
        self.assertTrue(any("missing from the text chunk store" in problem for problem in problems))
        self.assertTrue(any("missing from the chunk vector store" in problem for problem in problems))

    def test_index_store_verification_requires_matching_text_and_vector_ids(self):
        status = {"status": "processed", "chunks_count": 2, "chunks_list": ["chunk-1", "chunk-2"]}
        partial_vectors = [{"id": "chunk-1"}]
        problems = index_store_completion_problems(status, [{"_id": "chunk-1"}, {"_id": "chunk-2"}], partial_vectors)
        self.assertEqual(len(problems), 1)
        self.assertIn("1 indexed chunks are missing from the chunk vector store", problems[0])
        complete_vectors = [{"id": "chunk-1"}, {"id": "chunk-2"}]
        self.assertEqual(index_store_completion_problems(status, [{"_id": "chunk-1"}, {"_id": "chunk-2"}], complete_vectors), [])


if __name__ == "__main__":
    unittest.main()
