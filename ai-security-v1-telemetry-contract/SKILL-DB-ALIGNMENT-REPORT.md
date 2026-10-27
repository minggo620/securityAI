# Skill—数据库字段对齐校验报告

- Contract：`1.3.0` / `1.3.0-core-draft`
- 数据库表：36
- 数据库字段：527
- Skill/平台来源契约：13
- 投影事件：32
- 结论：所有来源契约均有完整脱敏快照能力；所有显式规范化目标均存在；所有数据库表均有生产来源和投影事件。

> `event_projection` 表示该列由对应事件的可信 Parent database-client 投影产生；它不是让 Agent 直接写数据库。完整原始结构始终先落 `audit_payload`，因此未规范化的 Skill 字段不会丢失。

## 来源契约覆盖

| 来源契约 | 必需字段/结构 | 完整快照 | 规范化映射组 |
| --- | ---: | --- | ---: |
| `run_metadata` | 12 | `audit_payload.content_json`<br>`audit_artifact.content_sha256` | 12 |
| `agent_process_sidecar` | schema | `audit_payload.content_json` | 15 |
| `recon_core_result` | 8 | `audit_payload.content_text` | 2 |
| `architecture` | 12 | `audit_payload.content_text`<br>`audit_artifact.content_sha256` | 2 |
| `coverage_ledger` | 19 | `audit_payload.content_json`<br>`audit_artifact.content_sha256` | 4 |
| `hunter_core_result` | 4 | `audit_payload.content_json` | 4 |
| `critic_core_result` | 4 | `audit_payload.content_json` | 4 |
| `candidate_verifier_result` | 2 | `audit_payload.content_json` | 4 |
| `findings` | schema | `audit_payload.content_json`<br>`audit_artifact.content_sha256` | 10 |
| `final_review_result` | 2 | `audit_payload.content_json` | 3 |
| `reports` | 3 | `audit_payload.content_text`<br>`audit_artifact.content_sha256` | 1 |
| `tool_and_validator_execution` | 8 | `audit_payload.content_json` | 1 |
| `human_adjudication` | 8 | `audit_payload.content_json` | 1 |

## 数据库逐字段能力

| 表 | 字段 | 生产能力 |
| --- | --- | --- |
| `audit_schema_version` | `version` | migration_generated |
| `audit_schema_version` | `ddl_sha256` | parent_computed_integrity |
| `audit_schema_version` | `description` | event_projection:database_contract |
| `audit_schema_version` | `schema_version` | platform_metadata |
| `audit_schema_version` | `source_class` | platform_metadata |
| `audit_schema_version` | `applied_at` | event_projection:database_contract |
| `audit_schema_version` | `created_at` | platform_metadata |
| `audit_run` | `run_id` | normalized:run_metadata:run_id |
| `audit_run` | `request_idempotency_key` | event_projection:run_metadata |
| `audit_run` | `request_idempotency_hash` | parent_computed_integrity |
| `audit_run` | `repo` | normalized:run_metadata:repo |
| `audit_run` | `target_locator_redacted` | normalized:run_metadata:target |
| `audit_run` | `target_locator_policy` | event_projection:run_metadata |
| `audit_run` | `source_ref` | normalized:run_metadata:source_ref |
| `audit_run` | `worktree_dirty` | normalized:run_metadata:source_ref |
| `audit_run` | `profile` | normalized:run_metadata:profile |
| `audit_run` | `budget` | normalized:run_metadata:budget |
| `audit_run` | `execution_policy` | normalized:run_metadata:execution_policy |
| `audit_run` | `skill_manifest_sha256` | parent_computed_integrity |
| `audit_run` | `skill_schema_version` | event_projection:run_metadata |
| `audit_run` | `telemetry_mode` | event_projection:run_metadata |
| `audit_run` | `telemetry_failure_policy` | event_projection:run_metadata |
| `audit_run` | `run_status` | normalized:run_metadata:run_status |
| `audit_run` | `telemetry_local_status` | event_projection:run_metadata |
| `audit_run` | `telemetry_remote_status` | event_projection:run_metadata |
| `audit_run` | `outbox_status` | event_projection:run_metadata |
| `audit_run` | `incomplete_reason` | event_projection:run_metadata |
| `audit_run` | `telemetry_incomplete_reason` | event_projection:run_metadata |
| `audit_run` | `started_at` | event_projection:run_metadata |
| `audit_run` | `ended_at` | event_projection:run_metadata |
| `audit_run` | `schema_version` | platform_metadata |
| `audit_run` | `source_class` | platform_metadata |
| `audit_run` | `row_version` | platform_metadata |
| `audit_run` | `created_at` | platform_metadata |
| `audit_run` | `updated_at` | platform_metadata |
| `audit_run_scope` | `scope_id` | parent_generated_or_relation_resolved |
| `audit_run_scope` | `run_id` | parent_generated_or_relation_resolved |
| `audit_run_scope` | `ordinal` | event_projection:run_metadata |
| `audit_run_scope` | `scope_type` | event_projection:run_metadata |
| `audit_run_scope` | `scope_value` | normalized:run_metadata:scope_paths[] |
| `audit_run_scope` | `included` | event_projection:run_metadata |
| `audit_run_scope` | `reason` | event_projection:run_metadata |
| `audit_run_scope` | `schema_version` | platform_metadata |
| `audit_run_scope` | `source_class` | platform_metadata |
| `audit_run_scope` | `created_at` | platform_metadata |
| `audit_payload` | `payload_id` | parent_generated_or_relation_resolved |
| `audit_payload` | `run_id` | parent_generated_or_relation_resolved |
| `audit_payload` | `payload_type` | event_projection:all source contracts |
| `audit_payload` | `mime_type` | event_projection:all source contracts |
| `audit_payload` | `content_json` | normalized:run_metadata:selected_companion_files|run_metadata:prior_run_paths|run_metadata:shared_file_owners|agent_process_sidecar:explicit_rationale|agent_process_sidecar:critic_review|hunter_core_result:hardening[]|hunter_core_result:uncovered[]|critic_core_result:resolved_prior_leads[]|critic_core_result:stop|findings:all remaining schema fields |
| `audit_payload` | `content_text` | snapshot:recon_core_result|architecture|reports |
| `audit_payload` | `content_sha256` | parent_computed_integrity |
| `audit_payload` | `stored_bytes` | event_projection:all source contracts |
| `audit_payload` | `original_bytes` | event_projection:all source contracts |
| `audit_payload` | `original_fingerprint_hmac` | parent_computed_integrity |
| `audit_payload` | `fingerprint_key_version` | event_projection:all source contracts |
| `audit_payload` | `is_truncated` | event_projection:all source contracts |
| `audit_payload` | `redaction_status` | event_projection:all source contracts |
| `audit_payload` | `redaction_profile` | event_projection:all source contracts |
| `audit_payload` | `redaction_version` | event_projection:all source contracts |
| `audit_payload` | `sensitivity` | event_projection:all source contracts |
| `audit_payload` | `retention_policy` | event_projection:all source contracts |
| `audit_payload` | `retain_until` | event_projection:all source contracts |
| `audit_payload` | `purged_at` | event_projection:all source contracts |
| `audit_payload` | `purge_reason` | event_projection:all source contracts |
| `audit_payload` | `schema_version` | platform_metadata |
| `audit_payload` | `source_class` | platform_metadata |
| `audit_payload` | `created_at` | platform_metadata |
| `audit_phase_execution` | `phase_execution_id` | parent_generated_or_relation_resolved |
| `audit_phase_execution` | `run_id` | parent_generated_or_relation_resolved |
| `audit_phase_execution` | `phase_code` | event_projection:Parent phase state |
| `audit_phase_execution` | `attempt_no` | event_projection:Parent phase state |
| `audit_phase_execution` | `status` | event_projection:Parent phase state |
| `audit_phase_execution` | `input_payload_id` | parent_generated_or_relation_resolved |
| `audit_phase_execution` | `output_payload_id` | parent_generated_or_relation_resolved |
| `audit_phase_execution` | `failure_reason` | event_projection:Parent phase state |
| `audit_phase_execution` | `started_at` | event_projection:Parent phase state |
| `audit_phase_execution` | `ended_at` | event_projection:Parent phase state |
| `audit_phase_execution` | `schema_version` | platform_metadata |
| `audit_phase_execution` | `source_class` | platform_metadata |
| `audit_phase_execution` | `created_at` | platform_metadata |
| `audit_event` | `event_id` | parent_generated_or_relation_resolved |
| `audit_event` | `run_id` | parent_generated_or_relation_resolved |
| `audit_event` | `phase_execution_id` | parent_generated_or_relation_resolved |
| `audit_event` | `event_type` | event_projection:event-envelope.schema.json |
| `audit_event` | `actor_type` | event_projection:event-envelope.schema.json |
| `audit_event` | `actor_id` | parent_generated_or_relation_resolved |
| `audit_event` | `agent_task_id` | parent_generated_or_relation_resolved |
| `audit_event` | `correlation_id` | parent_generated_or_relation_resolved |
| `audit_event` | `causation_id` | parent_generated_or_relation_resolved |
| `audit_event` | `idempotency_key` | event_projection:event-envelope.schema.json |
| `audit_event` | `idempotency_hash` | parent_computed_integrity |
| `audit_event` | `payload_id` | parent_generated_or_relation_resolved |
| `audit_event` | `source_refs_json` | event_projection:event-envelope.schema.json |
| `audit_event` | `envelope_sha256` | parent_computed_integrity |
| `audit_event` | `occurred_at` | event_projection:event-envelope.schema.json |
| `audit_event` | `schema_version` | platform_metadata |
| `audit_event` | `source_class` | platform_metadata |
| `audit_event` | `created_at` | platform_metadata |
| `audit_agent_task` | `task_id` | parent_generated_or_relation_resolved |
| `audit_agent_task` | `run_id` | parent_generated_or_relation_resolved |
| `audit_agent_task` | `phase_execution_id` | parent_generated_or_relation_resolved |
| `audit_agent_task` | `parent_task_id` | parent_generated_or_relation_resolved |
| `audit_agent_task` | `agent_id` | normalized:agent_process_sidecar:agent_id |
| `audit_agent_task` | `role` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `subagent_type` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `task_kind` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `scope_summary` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `model_provider` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `model_name` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `model_version` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `reasoning_effort` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `model_config_json` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `input_tokens` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `output_tokens` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `cached_input_tokens` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `cost_amount` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `cost_currency` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `prompt_payload_id` | parent_generated_or_relation_resolved |
| `audit_agent_task` | `output_payload_id` | parent_generated_or_relation_resolved |
| `audit_agent_task` | `status` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `started_at` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `ended_at` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `queue_duration_ms` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `execution_duration_ms` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `retry_count` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `failure_reason` | event_projection:Parent task lifecycle|agent_process_sidecar |
| `audit_agent_task` | `schema_version` | platform_metadata |
| `audit_agent_task` | `source_class` | platform_metadata |
| `audit_agent_task` | `row_version` | platform_metadata |
| `audit_agent_task` | `created_at` | platform_metadata |
| `audit_agent_task` | `updated_at` | platform_metadata |
| `audit_tool_execution` | `tool_execution_id` | parent_generated_or_relation_resolved |
| `audit_tool_execution` | `run_id` | parent_generated_or_relation_resolved |
| `audit_tool_execution` | `task_id` | parent_generated_or_relation_resolved |
| `audit_tool_execution` | `tool_name` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `tool_version` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `invocation_kind` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `command_summary` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `input_payload_id` | parent_generated_or_relation_resolved |
| `audit_tool_execution` | `output_payload_id` | parent_generated_or_relation_resolved |
| `audit_tool_execution` | `sandbox_policy` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `exit_code` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `status` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `started_at` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `ended_at` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `wall_duration_ms` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `cpu_time_ms` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `peak_memory_bytes` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `stdout_bytes` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `stderr_bytes` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `timed_out` | normalized:tool_and_validator_execution:execution |
| `audit_tool_execution` | `schema_version` | platform_metadata |
| `audit_tool_execution` | `source_class` | platform_metadata |
| `audit_tool_execution` | `created_at` | platform_metadata |
| `audit_artifact` | `artifact_id` | parent_generated_or_relation_resolved |
| `audit_artifact` | `run_id` | parent_generated_or_relation_resolved |
| `audit_artifact` | `owner_task_id` | parent_generated_or_relation_resolved |
| `audit_artifact` | `artifact_kind` | normalized:reports:artifact metadata |
| `audit_artifact` | `version_no` | normalized:reports:artifact metadata |
| `audit_artifact` | `artifact_status` | normalized:reports:artifact metadata |
| `audit_artifact` | `relative_path` | normalized:reports:artifact metadata |
| `audit_artifact` | `path_hash` | parent_computed_integrity |
| `audit_artifact` | `content_sha256` | snapshot:run_metadata|architecture|coverage_ledger|findings|reports |
| `audit_artifact` | `byte_size` | normalized:reports:artifact metadata |
| `audit_artifact` | `mime_type` | normalized:reports:artifact metadata |
| `audit_artifact` | `promotion_status` | event_projection:run_metadata|architecture|coverage_ledger|findings|reports|tool_and_validator_execution |
| `audit_artifact` | `promotion_reason` | event_projection:run_metadata|architecture|coverage_ledger|findings|reports|tool_and_validator_execution |
| `audit_artifact` | `schema_version` | platform_metadata |
| `audit_artifact` | `source_class` | platform_metadata |
| `audit_artifact` | `created_at` | platform_metadata |
| `audit_evidence` | `evidence_id` | parent_generated_or_relation_resolved |
| `audit_evidence` | `run_id` | parent_generated_or_relation_resolved |
| `audit_evidence` | `producer_task_id` | parent_generated_or_relation_resolved |
| `audit_evidence` | `evidence_type` | event_projection:agent_process_sidecar|recon_core_result|coverage_ledger|findings |
| `audit_evidence` | `repo_path` | normalized:agent_process_sidecar:evidence_refs[]|recon_core_result:source references |
| `audit_evidence` | `start_line` | normalized:agent_process_sidecar:evidence_refs[]|recon_core_result:source references |
| `audit_evidence` | `end_line` | normalized:agent_process_sidecar:evidence_refs[]|recon_core_result:source references |
| `audit_evidence` | `scope_name` | normalized:agent_process_sidecar:evidence_refs[] |
| `audit_evidence` | `description` | normalized:agent_process_sidecar:evidence_refs[] |
| `audit_evidence` | `artifact_id` | parent_generated_or_relation_resolved |
| `audit_evidence` | `tool_execution_id` | parent_generated_or_relation_resolved |
| `audit_evidence` | `payload_id` | parent_generated_or_relation_resolved |
| `audit_evidence` | `evidence_sha256` | normalized:agent_process_sidecar:evidence_refs[] |
| `audit_evidence` | `schema_version` | platform_metadata |
| `audit_evidence` | `source_class` | platform_metadata |
| `audit_evidence` | `created_at` | platform_metadata |
| `audit_recon_fact` | `recon_fact_id` | parent_generated_or_relation_resolved |
| `audit_recon_fact` | `run_id` | parent_generated_or_relation_resolved |
| `audit_recon_fact` | `task_id` | parent_generated_or_relation_resolved |
| `audit_recon_fact` | `recon_kind` | normalized:agent_process_sidecar:recon_facts[] |
| `audit_recon_fact` | `fact_kind` | normalized:agent_process_sidecar:recon_facts[] |
| `audit_recon_fact` | `statement` | normalized:agent_process_sidecar:recon_facts[]|recon_core_result:accepted facts |
| `audit_recon_fact` | `evidence_id` | parent_generated_or_relation_resolved |
| `audit_recon_fact` | `evidence_strength` | normalized:agent_process_sidecar:recon_facts[] |
| `audit_recon_fact` | `unknown_reason` | normalized:agent_process_sidecar:recon_facts[] |
| `audit_recon_fact` | `accepted_by_parent` | normalized:recon_core_result:accepted facts |
| `audit_recon_fact` | `included_in_architecture` | normalized:recon_core_result:accepted facts |
| `audit_recon_fact` | `schema_version` | platform_metadata |
| `audit_recon_fact` | `source_class` | platform_metadata |
| `audit_recon_fact` | `created_at` | platform_metadata |
| `audit_architecture_snapshot` | `architecture_snapshot_id` | parent_generated_or_relation_resolved |
| `audit_architecture_snapshot` | `run_id` | parent_generated_or_relation_resolved |
| `audit_architecture_snapshot` | `version_no` | normalized:architecture:version |
| `audit_architecture_snapshot` | `payload_id` | normalized:architecture:content |
| `audit_architecture_snapshot` | `content_sha256` | normalized:architecture:content |
| `audit_architecture_snapshot` | `generated_by_task_id` | parent_generated_or_relation_resolved |
| `audit_architecture_snapshot` | `schema_version` | platform_metadata |
| `audit_architecture_snapshot` | `source_class` | platform_metadata |
| `audit_architecture_snapshot` | `created_at` | platform_metadata |
| `audit_coverage_unit` | `coverage_unit_id` | parent_generated_or_relation_resolved |
| `audit_coverage_unit` | `run_id` | parent_generated_or_relation_resolved |
| `audit_coverage_unit` | `coverage_id` | normalized:coverage_ledger:identity and labels|hunter_core_result:uncovered[]|critic_core_result:missing_units[] |
| `audit_coverage_unit` | `coverage_id_hash` | normalized:coverage_ledger:identity and labels |
| `audit_coverage_unit` | `canonical_refs` | normalized:coverage_ledger:identity and labels |
| `audit_coverage_unit` | `surface_label` | normalized:coverage_ledger:identity and labels |
| `audit_coverage_unit` | `boundary_label` | normalized:coverage_ledger:identity and labels |
| `audit_coverage_unit` | `subsystem_label` | normalized:coverage_ledger:identity and labels |
| `audit_coverage_unit` | `attack_class_label` | normalized:coverage_ledger:identity and labels |
| `audit_coverage_unit` | `lifecycle_label` | normalized:coverage_ledger:identity and labels |
| `audit_coverage_unit` | `starting_paths` | normalized:coverage_ledger:assignment blocks |
| `audit_coverage_unit` | `blocks_json` | normalized:coverage_ledger:assignment blocks|critic_core_result:missing_units[] |
| `audit_coverage_unit` | `prior_status` | normalized:coverage_ledger:assignment blocks |
| `audit_coverage_unit` | `wave` | normalized:coverage_ledger:assignment blocks |
| `audit_coverage_unit` | `status` | normalized:agent_process_sidecar:critic_review|coverage_ledger:assignment blocks|hunter_core_result:units[] |
| `audit_coverage_unit` | `owner_task_id` | normalized:coverage_ledger:assignment blocks |
| `audit_coverage_unit` | `reviewed_paths` | normalized:coverage_ledger:live evidence|hunter_core_result:units[] |
| `audit_coverage_unit` | `result_fingerprints` | normalized:coverage_ledger:live evidence|hunter_core_result:units[] |
| `audit_coverage_unit` | `unresolved` | normalized:coverage_ledger:live evidence|hunter_core_result:units[] |
| `audit_coverage_unit` | `schema_version` | platform_metadata |
| `audit_coverage_unit` | `source_class` | platform_metadata |
| `audit_coverage_unit` | `row_version` | platform_metadata |
| `audit_coverage_unit` | `created_at` | platform_metadata |
| `audit_coverage_unit` | `updated_at` | platform_metadata |
| `audit_coverage_attempt` | `coverage_attempt_id` | parent_generated_or_relation_resolved |
| `audit_coverage_attempt` | `coverage_unit_id` | normalized:critic_core_result:reassign_ids[] |
| `audit_coverage_attempt` | `wave` | normalized:coverage_ledger:attempts[] |
| `audit_coverage_attempt` | `status` | normalized:coverage_ledger:attempts[] |
| `audit_coverage_attempt` | `owner_task_id` | normalized:coverage_ledger:attempts[] |
| `audit_coverage_attempt` | `snapshot_payload_id` | normalized:coverage_ledger:attempts[] |
| `audit_coverage_attempt` | `reassignment_reason` | normalized:agent_process_sidecar:critic_review|coverage_ledger:attempts[]|critic_core_result:reassign_ids[] |
| `audit_coverage_attempt` | `schema_version` | platform_metadata |
| `audit_coverage_attempt` | `source_class` | platform_metadata |
| `audit_coverage_attempt` | `created_at` | platform_metadata |
| `audit_check` | `check_id` | normalized:hunter_core_result:units[] |
| `audit_check` | `coverage_unit_id` | parent_generated_or_relation_resolved |
| `audit_check` | `coverage_attempt_id` | parent_generated_or_relation_resolved |
| `audit_check` | `owner_task_id` | parent_generated_or_relation_resolved |
| `audit_check` | `invariant_text` | normalized:coverage_ledger:live evidence |
| `audit_check` | `method` | normalized:coverage_ledger:live evidence |
| `audit_check` | `result_text` | normalized:coverage_ledger:live evidence |
| `audit_check` | `reviewed_paths` | normalized:coverage_ledger:live evidence |
| `audit_check` | `artifact_id` | normalized:coverage_ledger:live evidence |
| `audit_check` | `schema_version` | platform_metadata |
| `audit_check` | `source_class` | platform_metadata |
| `audit_check` | `created_at` | platform_metadata |
| `audit_hypothesis` | `hypothesis_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis` | `run_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis` | `coverage_unit_id` | normalized:agent_process_sidecar:hypotheses[].primary_coverage_id |
| `audit_hypothesis` | `creator_task_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis` | `local_hypothesis_key` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis` | `current_version_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis` | `status` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis` | `schema_version` | platform_metadata |
| `audit_hypothesis` | `source_class` | platform_metadata |
| `audit_hypothesis` | `row_version` | platform_metadata |
| `audit_hypothesis` | `created_at` | platform_metadata |
| `audit_hypothesis` | `updated_at` | platform_metadata |
| `audit_hypothesis_version` | `hypothesis_version_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_version` | `hypothesis_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_version` | `version_no` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `author_task_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_version` | `attacker_principal` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `attacker_capabilities` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `controlled_input` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `entrypoint` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `expected_invariant` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `suspected_control_failure` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `predicted_trace` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `target_boundary` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `affected_resource` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `predicted_result` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `preconditions_json` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `unknown_facts_json` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `alternative_explanations_json` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `revision_reason` | normalized:agent_process_sidecar:hypotheses[] |
| `audit_hypothesis_version` | `schema_version` | platform_metadata |
| `audit_hypothesis_version` | `source_class` | platform_metadata |
| `audit_hypothesis_version` | `created_at` | platform_metadata |
| `audit_hypothesis_coverage` | `hypothesis_coverage_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_coverage` | `hypothesis_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_coverage` | `coverage_unit_id` | normalized:agent_process_sidecar:hypotheses[].coverage_ids[] |
| `audit_hypothesis_coverage` | `relation_kind` | event_projection:agent_process_sidecar |
| `audit_hypothesis_coverage` | `ordinal` | event_projection:agent_process_sidecar |
| `audit_hypothesis_coverage` | `schema_version` | platform_metadata |
| `audit_hypothesis_coverage` | `source_class` | platform_metadata |
| `audit_hypothesis_coverage` | `created_at` | platform_metadata |
| `audit_hypothesis_relation` | `hypothesis_relation_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_relation` | `run_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_relation` | `from_hypothesis_id` | normalized:agent_process_sidecar:hypothesis_relations[] |
| `audit_hypothesis_relation` | `to_hypothesis_id` | normalized:agent_process_sidecar:hypothesis_relations[] |
| `audit_hypothesis_relation` | `relation_kind` | normalized:agent_process_sidecar:hypothesis_relations[] |
| `audit_hypothesis_relation` | `event_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_relation` | `rationale` | normalized:agent_process_sidecar:hypothesis_relations[] |
| `audit_hypothesis_relation` | `schema_version` | platform_metadata |
| `audit_hypothesis_relation` | `source_class` | platform_metadata |
| `audit_hypothesis_relation` | `created_at` | platform_metadata |
| `audit_hypothesis_evidence` | `hypothesis_evidence_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_evidence` | `hypothesis_version_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_evidence` | `evidence_id` | normalized:agent_process_sidecar:hypotheses[].evidence_refs[] |
| `audit_hypothesis_evidence` | `relation_kind` | event_projection:agent_process_sidecar |
| `audit_hypothesis_evidence` | `weight` | event_projection:agent_process_sidecar |
| `audit_hypothesis_evidence` | `rationale` | event_projection:agent_process_sidecar |
| `audit_hypothesis_evidence` | `schema_version` | platform_metadata |
| `audit_hypothesis_evidence` | `source_class` | platform_metadata |
| `audit_hypothesis_evidence` | `created_at` | platform_metadata |
| `audit_hypothesis_score` | `hypothesis_score_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_score` | `hypothesis_version_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_score` | `score_no` | event_projection:agent_process_sidecar |
| `audit_hypothesis_score` | `scorer_task_id` | parent_generated_or_relation_resolved |
| `audit_hypothesis_score` | `predicted_probability` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `probability_rationale` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `potential_impact` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `coverage_value` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `information_gain` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `estimated_validation_cost` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `validation_cost_unit` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `estimated_duration_ms` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `estimated_agent_calls` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `estimated_token_count` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `priority_score` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `formula_name` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `formula_version` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `scoring_protocol` | event_projection:agent_process_sidecar |
| `audit_hypothesis_score` | `scoring_protocol_version` | event_projection:agent_process_sidecar |
| `audit_hypothesis_score` | `model_config_sha256` | parent_computed_integrity |
| `audit_hypothesis_score` | `prompt_template_sha256` | parent_computed_integrity |
| `audit_hypothesis_score` | `evidence_as_of_event_id` | normalized:agent_process_sidecar:hypotheses[].score |
| `audit_hypothesis_score` | `scored_at` | event_projection:agent_process_sidecar |
| `audit_hypothesis_score` | `schema_version` | platform_metadata |
| `audit_hypothesis_score` | `source_class` | platform_metadata |
| `audit_hypothesis_score` | `created_at` | platform_metadata |
| `audit_attack_plan` | `attack_plan_id` | parent_generated_or_relation_resolved |
| `audit_attack_plan` | `hypothesis_version_id` | parent_generated_or_relation_resolved |
| `audit_attack_plan` | `plan_version_no` | normalized:agent_process_sidecar:attack_plans[] |
| `audit_attack_plan` | `author_task_id` | parent_generated_or_relation_resolved |
| `audit_attack_plan` | `plan_mode` | normalized:agent_process_sidecar:attack_plans[] |
| `audit_attack_plan` | `objective` | normalized:agent_process_sidecar:attack_plans[] |
| `audit_attack_plan` | `stop_condition` | normalized:agent_process_sidecar:attack_plans[] |
| `audit_attack_plan` | `expected_boundary_result` | normalized:agent_process_sidecar:attack_plans[] |
| `audit_attack_plan` | `status` | normalized:agent_process_sidecar:attack_plans[] |
| `audit_attack_plan` | `schema_version` | platform_metadata |
| `audit_attack_plan` | `source_class` | platform_metadata |
| `audit_attack_plan` | `created_at` | platform_metadata |
| `audit_attack_step` | `attack_step_id` | parent_generated_or_relation_resolved |
| `audit_attack_step` | `attack_plan_id` | parent_generated_or_relation_resolved |
| `audit_attack_step` | `ordinal` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `action_kind` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `action_text` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `precondition_text` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `input_description` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `expected_result` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `planned_tool` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `status` | normalized:agent_process_sidecar:attack_plans[].steps[] |
| `audit_attack_step` | `schema_version` | platform_metadata |
| `audit_attack_step` | `source_class` | platform_metadata |
| `audit_attack_step` | `created_at` | platform_metadata |
| `audit_attack_execution` | `attack_execution_id` | parent_generated_or_relation_resolved |
| `audit_attack_execution` | `attack_step_id` | parent_generated_or_relation_resolved |
| `audit_attack_execution` | `execution_no` | event_projection:agent_process_sidecar|tool_and_validator_execution |
| `audit_attack_execution` | `executor_task_id` | parent_generated_or_relation_resolved |
| `audit_attack_execution` | `execution_mode` | normalized:agent_process_sidecar:observations[] |
| `audit_attack_execution` | `status` | normalized:agent_process_sidecar:observations[] |
| `audit_attack_execution` | `actual_input_payload_id` | normalized:agent_process_sidecar:observations[] |
| `audit_attack_execution` | `observed_result` | normalized:agent_process_sidecar:observations[] |
| `audit_attack_execution` | `tool_execution_id` | parent_generated_or_relation_resolved |
| `audit_attack_execution` | `evidence_id` | parent_generated_or_relation_resolved |
| `audit_attack_execution` | `blocker_reason` | normalized:agent_process_sidecar:observations[] |
| `audit_attack_execution` | `started_at` | event_projection:agent_process_sidecar|tool_and_validator_execution |
| `audit_attack_execution` | `ended_at` | event_projection:agent_process_sidecar|tool_and_validator_execution |
| `audit_attack_execution` | `schema_version` | platform_metadata |
| `audit_attack_execution` | `source_class` | platform_metadata |
| `audit_attack_execution` | `created_at` | platform_metadata |
| `audit_candidate` | `candidate_id` | parent_generated_or_relation_resolved |
| `audit_candidate` | `run_id` | parent_generated_or_relation_resolved |
| `audit_candidate` | `fingerprint` | event_projection:hunter_core_result|candidate_verifier_result|Parent consolidation |
| `audit_candidate` | `fingerprint_hash` | parent_computed_integrity |
| `audit_candidate` | `consolidated_payload_id` | parent_generated_or_relation_resolved |
| `audit_candidate` | `status` | event_projection:hunter_core_result|candidate_verifier_result|Parent consolidation |
| `audit_candidate` | `schema_version` | platform_metadata |
| `audit_candidate` | `source_class` | platform_metadata |
| `audit_candidate` | `row_version` | platform_metadata |
| `audit_candidate` | `created_at` | platform_metadata |
| `audit_candidate` | `updated_at` | platform_metadata |
| `audit_candidate_observation` | `candidate_observation_id` | parent_generated_or_relation_resolved |
| `audit_candidate_observation` | `run_id` | parent_generated_or_relation_resolved |
| `audit_candidate_observation` | `candidate_id` | parent_generated_or_relation_resolved |
| `audit_candidate_observation` | `producer_task_id` | parent_generated_or_relation_resolved |
| `audit_candidate_observation` | `observation_kind` | normalized:hunter_core_result:candidates[] |
| `audit_candidate_observation` | `hypothesis_version_id` | parent_generated_or_relation_resolved |
| `audit_candidate_observation` | `local_fingerprint` | normalized:hunter_core_result:candidates[] |
| `audit_candidate_observation` | `local_fingerprint_hash` | parent_computed_integrity |
| `audit_candidate_observation` | `proposed_verdict` | normalized:hunter_core_result:candidates[] |
| `audit_candidate_observation` | `payload_id` | normalized:hunter_core_result:candidates[] |
| `audit_candidate_observation` | `observed_at` | event_projection:hunter_core_result|Prior-run carry|Verifier new root |
| `audit_candidate_observation` | `schema_version` | platform_metadata |
| `audit_candidate_observation` | `source_class` | platform_metadata |
| `audit_candidate_observation` | `created_at` | platform_metadata |
| `audit_candidate_hypothesis` | `candidate_hypothesis_id` | parent_generated_or_relation_resolved |
| `audit_candidate_hypothesis` | `candidate_id` | parent_generated_or_relation_resolved |
| `audit_candidate_hypothesis` | `hypothesis_version_id` | parent_generated_or_relation_resolved |
| `audit_candidate_hypothesis` | `relation_kind` | event_projection:agent_process_sidecar|Parent consolidation |
| `audit_candidate_hypothesis` | `is_primary` | event_projection:agent_process_sidecar|Parent consolidation |
| `audit_candidate_hypothesis` | `schema_version` | platform_metadata |
| `audit_candidate_hypothesis` | `source_class` | platform_metadata |
| `audit_candidate_hypothesis` | `created_at` | platform_metadata |
| `audit_candidate_coverage` | `candidate_coverage_id` | parent_generated_or_relation_resolved |
| `audit_candidate_coverage` | `candidate_id` | parent_generated_or_relation_resolved |
| `audit_candidate_coverage` | `coverage_unit_id` | parent_generated_or_relation_resolved |
| `audit_candidate_coverage` | `relation_kind` | event_projection:coverage_ledger|Parent consolidation |
| `audit_candidate_coverage` | `schema_version` | platform_metadata |
| `audit_candidate_coverage` | `source_class` | platform_metadata |
| `audit_candidate_coverage` | `created_at` | platform_metadata |
| `audit_validation` | `validation_id` | parent_generated_or_relation_resolved |
| `audit_validation` | `candidate_id` | normalized:candidate_verifier_result:input identity |
| `audit_validation` | `input_hypothesis_version_id` | normalized:candidate_verifier_result:input identity |
| `audit_validation` | `input_finding_revision_id` | normalized:final_review_result:input revision |
| `audit_validation` | `input_sha256` | normalized:agent_process_sidecar:decision_input|candidate_verifier_result:input identity|final_review_result:input revision |
| `audit_validation` | `validation_no` | event_projection:candidate_verifier_result|final_review_result |
| `audit_validation` | `phase_code` | event_projection:candidate_verifier_result|final_review_result |
| `audit_validation` | `verifier_task_id` | normalized:candidate_verifier_result:independence |
| `audit_validation` | `validation_kind` | event_projection:candidate_verifier_result|final_review_result |
| `audit_validation` | `independence_status` | normalized:candidate_verifier_result:independence |
| `audit_validation` | `method_summary` | normalized:agent_process_sidecar:decision_input |
| `audit_validation` | `strongest_control` | normalized:agent_process_sidecar:decision_input |
| `audit_validation` | `status` | event_projection:candidate_verifier_result|final_review_result |
| `audit_validation` | `started_at` | event_projection:candidate_verifier_result|final_review_result |
| `audit_validation` | `ended_at` | event_projection:candidate_verifier_result|final_review_result |
| `audit_validation` | `schema_version` | platform_metadata |
| `audit_validation` | `source_class` | platform_metadata |
| `audit_validation` | `created_at` | platform_metadata |
| `audit_validation_observation` | `validation_observation_id` | parent_generated_or_relation_resolved |
| `audit_validation_observation` | `validation_id` | parent_generated_or_relation_resolved |
| `audit_validation_observation` | `ordinal` | event_projection:agent_process_sidecar|candidate_verifier_result|final_review_result |
| `audit_validation_observation` | `observation_kind` | normalized:agent_process_sidecar:observations[] |
| `audit_validation_observation` | `expected_text` | normalized:agent_process_sidecar:observations[] |
| `audit_validation_observation` | `observed_text` | normalized:agent_process_sidecar:observations[] |
| `audit_validation_observation` | `relation_to_claim` | normalized:agent_process_sidecar:observations[] |
| `audit_validation_observation` | `evidence_id` | parent_generated_or_relation_resolved |
| `audit_validation_observation` | `schema_version` | platform_metadata |
| `audit_validation_observation` | `source_class` | platform_metadata |
| `audit_validation_observation` | `created_at` | platform_metadata |
| `audit_decision` | `decision_id` | parent_generated_or_relation_resolved |
| `audit_decision` | `validation_id` | parent_generated_or_relation_resolved |
| `audit_decision` | `decision_no` | event_projection:candidate_verifier_result|final_review_result |
| `audit_decision` | `decision` | normalized:candidate_verifier_result:decision|final_review_result:verified|final_review_result:replace |
| `audit_decision` | `reason` | event_projection:candidate_verifier_result|final_review_result |
| `audit_decision` | `record_payload_id` | normalized:candidate_verifier_result:record |
| `audit_decision` | `material_change` | normalized:final_review_result:replace |
| `audit_decision` | `supersedes_decision_id` | parent_generated_or_relation_resolved |
| `audit_decision` | `decided_at` | event_projection:candidate_verifier_result|final_review_result |
| `audit_decision` | `schema_version` | platform_metadata |
| `audit_decision` | `source_class` | platform_metadata |
| `audit_decision` | `created_at` | platform_metadata |
| `audit_finding` | `finding_id` | parent_generated_or_relation_resolved |
| `audit_finding` | `run_id` | parent_generated_or_relation_resolved |
| `audit_finding` | `candidate_id` | parent_generated_or_relation_resolved |
| `audit_finding` | `fingerprint` | normalized:findings:[].fingerprint |
| `audit_finding` | `fingerprint_hash` | normalized:findings:[].fingerprint |
| `audit_finding` | `current_revision_id` | parent_generated_or_relation_resolved |
| `audit_finding` | `current_verdict` | normalized:findings:[].verdict |
| `audit_finding` | `status` | normalized:final_review_result:verified |
| `audit_finding` | `schema_version` | platform_metadata |
| `audit_finding` | `source_class` | platform_metadata |
| `audit_finding` | `row_version` | platform_metadata |
| `audit_finding` | `created_at` | platform_metadata |
| `audit_finding` | `updated_at` | platform_metadata |
| `audit_finding_revision` | `finding_revision_id` | parent_generated_or_relation_resolved |
| `audit_finding_revision` | `finding_id` | parent_generated_or_relation_resolved |
| `audit_finding_revision` | `decision_id` | parent_generated_or_relation_resolved |
| `audit_finding_revision` | `revision_no` | event_projection:findings|final_review_result |
| `audit_finding_revision` | `verdict` | normalized:findings:[].verdict |
| `audit_finding_revision` | `title` | normalized:findings:[].title |
| `audit_finding_revision` | `record_payload_id` | normalized:candidate_verifier_result:record|findings:all remaining schema fields |
| `audit_finding_revision` | `severity_overall` | normalized:findings:[].severity.overall_severity |
| `audit_finding_revision` | `confidence_score` | normalized:findings:[].confidence.score |
| `audit_finding_revision` | `confidence_reason` | normalized:findings:[].confidence.reason |
| `audit_finding_revision` | `severity_likelihood` | normalized:findings:[].severity.likelihood.score |
| `audit_finding_revision` | `severity_impact` | normalized:findings:[].severity.impact.score |
| `audit_finding_revision` | `status` | event_projection:findings|final_review_result |
| `audit_finding_revision` | `supersedes_revision_id` | normalized:final_review_result:replace |
| `audit_finding_revision` | `change_reason` | normalized:final_review_result:replace |
| `audit_finding_revision` | `schema_version` | platform_metadata |
| `audit_finding_revision` | `source_class` | platform_metadata |
| `audit_finding_revision` | `created_at` | platform_metadata |
| `audit_finding_evidence` | `finding_evidence_id` | parent_generated_or_relation_resolved |
| `audit_finding_evidence` | `finding_revision_id` | parent_generated_or_relation_resolved |
| `audit_finding_evidence` | `evidence_id` | normalized:findings:[].trace[] and [].evidence[] |
| `audit_finding_evidence` | `relation_kind` | event_projection:findings |
| `audit_finding_evidence` | `ordinal` | event_projection:findings |
| `audit_finding_evidence` | `schema_version` | platform_metadata |
| `audit_finding_evidence` | `source_class` | platform_metadata |
| `audit_finding_evidence` | `created_at` | platform_metadata |
| `audit_finding_coverage` | `finding_coverage_id` | parent_generated_or_relation_resolved |
| `audit_finding_coverage` | `finding_revision_id` | parent_generated_or_relation_resolved |
| `audit_finding_coverage` | `coverage_unit_id` | parent_generated_or_relation_resolved |
| `audit_finding_coverage` | `relation_kind` | event_projection:coverage_ledger|findings |
| `audit_finding_coverage` | `ordinal` | event_projection:coverage_ledger|findings |
| `audit_finding_coverage` | `schema_version` | platform_metadata |
| `audit_finding_coverage` | `source_class` | platform_metadata |
| `audit_finding_coverage` | `created_at` | platform_metadata |
| `audit_human_adjudication` | `adjudication_id` | parent_generated_or_relation_resolved |
| `audit_human_adjudication` | `run_id` | parent_generated_or_relation_resolved |
| `audit_human_adjudication` | `subject_type` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `label_scheme` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `hypothesis_id` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `candidate_id` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `finding_id` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `adjudicator_pseudonym` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `label` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `rationale` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `evidence_payload_id` | parent_generated_or_relation_resolved |
| `audit_human_adjudication` | `eligible_for_metrics` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `adjudicated_at` | normalized:human_adjudication:label |
| `audit_human_adjudication` | `schema_version` | platform_metadata |
| `audit_human_adjudication` | `source_class` | platform_metadata |
| `audit_human_adjudication` | `created_at` | platform_metadata |

