/*
 Navicat Premium Data Transfer

 Source Server         : AISecurity
 Source Server Type    : MySQL
 Source Server Version : 80026 (8.0.26)
 Source Host           : 175.24.172.213:3306
 Source Schema         : ai_security

 Target Server Type    : MySQL
 Target Server Version : 80026 (8.0.26)
 File Encoding         : 65001

 Date: 27/10/2026 16:24:33
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for audit_agent_task
-- ----------------------------
DROP TABLE IF EXISTS `audit_agent_task`;
CREATE TABLE `audit_agent_task` (
  `task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `phase_execution_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `parent_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `agent_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `role` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `subagent_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `task_kind` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `scope_summary` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `model_provider` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `model_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `model_version` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reasoning_effort` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `model_config_json` json DEFAULT NULL,
  `input_tokens` bigint unsigned DEFAULT NULL,
  `output_tokens` bigint unsigned DEFAULT NULL,
  `cached_input_tokens` bigint unsigned DEFAULT NULL,
  `cost_amount` decimal(20,8) DEFAULT NULL,
  `cost_currency` char(3) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `prompt_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `output_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `started_at` datetime(6) DEFAULT NULL,
  `ended_at` datetime(6) DEFAULT NULL,
  `queue_duration_ms` bigint unsigned DEFAULT NULL,
  `execution_duration_ms` bigint unsigned DEFAULT NULL,
  `retry_count` int unsigned NOT NULL DEFAULT '0',
  `failure_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `row_version` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`task_id`),
  UNIQUE KEY `uq_task_agent` (`run_id`,`agent_id`),
  KEY `ix_task_phase_status` (`phase_execution_id`,`status`),
  KEY `fk_task_parent` (`parent_task_id`),
  KEY `fk_task_prompt` (`prompt_payload_id`),
  KEY `fk_task_output` (`output_payload_id`),
  CONSTRAINT `fk_task_output` FOREIGN KEY (`output_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_task_parent` FOREIGN KEY (`parent_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_task_phase` FOREIGN KEY (`phase_execution_id`) REFERENCES `audit_phase_execution` (`phase_execution_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_task_prompt` FOREIGN KEY (`prompt_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_task_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_task_cost` CHECK ((((`cost_amount` is null) and (`cost_currency` is null)) or ((`cost_amount` is not null) and (`cost_amount` >= 0) and (`cost_currency` is not null)))),
  CONSTRAINT `chk_task_role` CHECK ((`role` in (_utf8mb4'parent',_utf8mb4'recon',_utf8mb4'hunter',_utf8mb4'critic',_utf8mb4'verifier',_utf8mb4'replacement_verifier'))),
  CONSTRAINT `chk_task_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_task_status` CHECK ((`status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'discarded',_utf8mb4'deferred')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_architecture_snapshot
-- ----------------------------
DROP TABLE IF EXISTS `audit_architecture_snapshot`;
CREATE TABLE `audit_architecture_snapshot` (
  `architecture_snapshot_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_no` int unsigned NOT NULL,
  `payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `content_sha256` binary(32) NOT NULL,
  `generated_by_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`architecture_snapshot_id`),
  UNIQUE KEY `uq_architecture_version` (`run_id`,`version_no`),
  KEY `fk_arch_payload` (`payload_id`),
  KEY `fk_arch_task` (`generated_by_task_id`),
  CONSTRAINT `fk_arch_payload` FOREIGN KEY (`payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_arch_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_arch_task` FOREIGN KEY (`generated_by_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_arch_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_artifact
-- ----------------------------
DROP TABLE IF EXISTS `audit_artifact`;
CREATE TABLE `audit_artifact` (
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `owner_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `artifact_kind` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `version_no` int unsigned NOT NULL DEFAULT '1',
  `artifact_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `relative_path` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `path_hash` binary(32) NOT NULL,
  `content_sha256` binary(32) NOT NULL,
  `byte_size` bigint unsigned NOT NULL,
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `promotion_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `promotion_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`artifact_id`),
  UNIQUE KEY `uq_artifact_version` (`run_id`,`artifact_kind`,`version_no`,`path_hash`),
  KEY `ix_artifact_owner` (`owner_task_id`,`created_at`),
  CONSTRAINT `fk_artifact_owner` FOREIGN KEY (`owner_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_artifact_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_artifact_kind` CHECK ((`artifact_kind` in (_utf8mb4'agent_evidence',_utf8mb4'run_metadata',_utf8mb4'architecture',_utf8mb4'coverage_ledger',_utf8mb4'findings_json',_utf8mb4'report',_utf8mb4'findings_detail',_utf8mb4'needs_validation',_utf8mb4'validator_input',_utf8mb4'validator_output'))),
  CONSTRAINT `chk_artifact_lifecycle` CHECK ((`artifact_status` in (_utf8mb4'draft',_utf8mb4'final',_utf8mb4'partial',_utf8mb4'superseded',_utf8mb4'discarded'))),
  CONSTRAINT `chk_artifact_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_artifact_status` CHECK ((`promotion_status` in (_utf8mb4'declared',_utf8mb4'promoted',_utf8mb4'rejected',_utf8mb4'discarded')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_attack_execution
-- ----------------------------
DROP TABLE IF EXISTS `audit_attack_execution`;
CREATE TABLE `audit_attack_execution` (
  `attack_execution_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attack_step_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `execution_no` int unsigned NOT NULL,
  `executor_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `execution_mode` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `actual_input_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `observed_result` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `tool_execution_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `blocker_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `started_at` datetime(6) DEFAULT NULL,
  `ended_at` datetime(6) DEFAULT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`attack_execution_id`),
  UNIQUE KEY `uq_attack_execution` (`attack_step_id`,`execution_no`),
  KEY `fk_execution_task` (`executor_task_id`),
  KEY `fk_execution_input` (`actual_input_payload_id`),
  KEY `fk_execution_tool` (`tool_execution_id`),
  KEY `fk_execution_evidence` (`evidence_id`),
  CONSTRAINT `fk_execution_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `audit_evidence` (`evidence_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_execution_input` FOREIGN KEY (`actual_input_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_execution_step` FOREIGN KEY (`attack_step_id`) REFERENCES `audit_attack_step` (`attack_step_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_execution_task` FOREIGN KEY (`executor_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_execution_tool` FOREIGN KEY (`tool_execution_id`) REFERENCES `audit_tool_execution` (`tool_execution_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_execution_mode` CHECK ((`execution_mode` in (_utf8mb4'source_only',_utf8mb4'local',_utf8mb4'not_executed'))),
  CONSTRAINT `chk_execution_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_execution_status` CHECK ((`status` in (_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'blocked',_utf8mb4'skipped')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_attack_plan
-- ----------------------------
DROP TABLE IF EXISTS `audit_attack_plan`;
CREATE TABLE `audit_attack_plan` (
  `attack_plan_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hypothesis_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `plan_version_no` int unsigned NOT NULL,
  `author_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `plan_mode` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `objective` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `stop_condition` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `expected_boundary_result` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`attack_plan_id`),
  UNIQUE KEY `uq_attack_plan_version` (`hypothesis_version_id`,`plan_version_no`),
  KEY `fk_plan_author` (`author_task_id`),
  CONSTRAINT `fk_plan_author` FOREIGN KEY (`author_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_plan_hv` FOREIGN KEY (`hypothesis_version_id`) REFERENCES `audit_hypothesis_version` (`hypothesis_version_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_plan_mode` CHECK ((`plan_mode` in (_utf8mb4'source_only',_utf8mb4'bounded_local',_utf8mb4'owner_observed',_utf8mb4'mixed'))),
  CONSTRAINT `chk_plan_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_plan_status` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'approved',_utf8mb4'running',_utf8mb4'completed',_utf8mb4'blocked',_utf8mb4'abandoned')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_attack_step
-- ----------------------------
DROP TABLE IF EXISTS `audit_attack_step`;
CREATE TABLE `audit_attack_step` (
  `attack_step_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attack_plan_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `action_kind` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `action_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `precondition_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `input_description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `expected_result` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `planned_tool` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`attack_step_id`),
  UNIQUE KEY `uq_attack_step_order` (`attack_plan_id`,`ordinal`),
  CONSTRAINT `fk_step_plan` FOREIGN KEY (`attack_plan_id`) REFERENCES `audit_attack_plan` (`attack_plan_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_step_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_step_status` CHECK ((`status` in (_utf8mb4'planned',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'blocked',_utf8mb4'skipped')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_candidate
-- ----------------------------
DROP TABLE IF EXISTS `audit_candidate`;
CREATE TABLE `audit_candidate` (
  `candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `fingerprint` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `fingerprint_hash` binary(32) NOT NULL,
  `consolidated_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `row_version` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`candidate_id`),
  UNIQUE KEY `uq_candidate_fingerprint` (`run_id`,`fingerprint_hash`),
  KEY `fk_candidate_payload` (`consolidated_payload_id`),
  CONSTRAINT `fk_candidate_payload` FOREIGN KEY (`consolidated_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_candidate_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_candidate_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_candidate_status` CHECK ((`status` in (_utf8mb4'proposed',_utf8mb4'queued_for_validation',_utf8mb4'validating',_utf8mb4'decided',_utf8mb4'unvalidated',_utf8mb4'discarded')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_candidate_coverage
-- ----------------------------
DROP TABLE IF EXISTS `audit_candidate_coverage`;
CREATE TABLE `audit_candidate_coverage` (
  `candidate_coverage_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_unit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`candidate_coverage_id`),
  UNIQUE KEY `uq_candidate_coverage` (`candidate_id`,`coverage_unit_id`,`relation_kind`),
  KEY `fk_cc_coverage` (`coverage_unit_id`),
  CONSTRAINT `fk_cc_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `audit_candidate` (`candidate_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cc_coverage` FOREIGN KEY (`coverage_unit_id`) REFERENCES `audit_coverage_unit` (`coverage_unit_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_cc_relation` CHECK ((`relation_kind` in (_utf8mb4'origin',_utf8mb4'affected',_utf8mb4'supporting',_utf8mb4'duplicate'))),
  CONSTRAINT `chk_cc_source` CHECK ((`source_class` = _utf8mb4'P'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_candidate_hypothesis
-- ----------------------------
DROP TABLE IF EXISTS `audit_candidate_hypothesis`;
CREATE TABLE `audit_candidate_hypothesis` (
  `candidate_hypothesis_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hypothesis_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT '0',
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`candidate_hypothesis_id`),
  UNIQUE KEY `uq_candidate_hypothesis` (`candidate_id`,`hypothesis_version_id`),
  KEY `fk_ch_hv` (`hypothesis_version_id`),
  CONSTRAINT `fk_ch_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `audit_candidate` (`candidate_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_ch_hv` FOREIGN KEY (`hypothesis_version_id`) REFERENCES `audit_hypothesis_version` (`hypothesis_version_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_ch_relation` CHECK ((`relation_kind` in (_utf8mb4'origin',_utf8mb4'supports',_utf8mb4'alternative',_utf8mb4'merged'))),
  CONSTRAINT `chk_ch_source` CHECK ((`source_class` = _utf8mb4'P'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_candidate_observation
-- ----------------------------
DROP TABLE IF EXISTS `audit_candidate_observation`;
CREATE TABLE `audit_candidate_observation` (
  `candidate_observation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `producer_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `observation_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `hypothesis_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `local_fingerprint` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `local_fingerprint_hash` binary(32) NOT NULL,
  `proposed_verdict` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `observed_at` datetime(6) NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`candidate_observation_id`),
  UNIQUE KEY `uq_candidate_observation` (`run_id`,`producer_task_id`,`hypothesis_version_id`,`local_fingerprint_hash`),
  KEY `ix_candidate_observation_local` (`producer_task_id`,`local_fingerprint_hash`),
  KEY `fk_co_candidate` (`candidate_id`),
  KEY `fk_co_hv` (`hypothesis_version_id`),
  KEY `fk_co_payload` (`payload_id`),
  CONSTRAINT `fk_co_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `audit_candidate` (`candidate_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_co_hv` FOREIGN KEY (`hypothesis_version_id`) REFERENCES `audit_hypothesis_version` (`hypothesis_version_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_co_payload` FOREIGN KEY (`payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_co_producer` FOREIGN KEY (`producer_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_co_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_co_kind` CHECK ((`observation_kind` in (_utf8mb4'hunter_proposal',_utf8mb4'prior_carried',_utf8mb4'verifier_new_root'))),
  CONSTRAINT `chk_co_source` CHECK ((`source_class` in (_utf8mb4'O',_utf8mb4'P'))),
  CONSTRAINT `chk_co_verdict` CHECK ((`proposed_verdict` in (_utf8mb4'confirmed',_utf8mb4'needs_validation')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_check
-- ----------------------------
DROP TABLE IF EXISTS `audit_check`;
CREATE TABLE `audit_check` (
  `check_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_unit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `owner_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invariant_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `method` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `result_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `reviewed_paths` json NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`check_id`),
  KEY `ix_check_unit` (`coverage_unit_id`,`created_at`),
  KEY `fk_check_attempt` (`coverage_attempt_id`),
  KEY `fk_check_owner` (`owner_task_id`),
  KEY `fk_check_artifact` (`artifact_id`),
  CONSTRAINT `fk_check_artifact` FOREIGN KEY (`artifact_id`) REFERENCES `audit_artifact` (`artifact_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_check_attempt` FOREIGN KEY (`coverage_attempt_id`) REFERENCES `audit_coverage_attempt` (`coverage_attempt_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_check_owner` FOREIGN KEY (`owner_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_check_unit` FOREIGN KEY (`coverage_unit_id`) REFERENCES `audit_coverage_unit` (`coverage_unit_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_check_artifact` CHECK ((((`method` = _utf8mb4'source') and (`artifact_id` is null)) or ((`method` = _utf8mb4'local') and (`artifact_id` is not null)))),
  CONSTRAINT `chk_check_method` CHECK ((`method` in (_utf8mb4'source',_utf8mb4'local'))),
  CONSTRAINT `chk_check_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_coverage_attempt
-- ----------------------------
DROP TABLE IF EXISTS `audit_coverage_attempt`;
CREATE TABLE `audit_coverage_attempt` (
  `coverage_attempt_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_unit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `wave` int unsigned NOT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `owner_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `snapshot_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reassignment_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`coverage_attempt_id`),
  UNIQUE KEY `uq_attempt_wave` (`coverage_unit_id`,`wave`),
  KEY `fk_attempt_owner` (`owner_task_id`),
  KEY `fk_attempt_payload` (`snapshot_payload_id`),
  CONSTRAINT `fk_attempt_owner` FOREIGN KEY (`owner_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_attempt_payload` FOREIGN KEY (`snapshot_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_attempt_unit` FOREIGN KEY (`coverage_unit_id`) REFERENCES `audit_coverage_unit` (`coverage_unit_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_attempt_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_attempt_status` CHECK ((`status` in (_utf8mb4'blocked',_utf8mb4'covered',_utf8mb4'candidate')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_coverage_unit
-- ----------------------------
DROP TABLE IF EXISTS `audit_coverage_unit`;
CREATE TABLE `audit_coverage_unit` (
  `coverage_unit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_id` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `coverage_id_hash` binary(32) NOT NULL,
  `canonical_refs` json NOT NULL,
  `surface_label` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `boundary_label` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `subsystem_label` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `attack_class_label` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `lifecycle_label` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `starting_paths` json NOT NULL,
  `blocks_json` json NOT NULL,
  `prior_status` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `wave` int unsigned NOT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `owner_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `reviewed_paths` json NOT NULL,
  `result_fingerprints` json NOT NULL,
  `unresolved` json NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `row_version` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`coverage_unit_id`),
  UNIQUE KEY `uq_coverage_id` (`run_id`,`coverage_id_hash`),
  KEY `ix_coverage_status` (`run_id`,`status`,`wave`),
  KEY `fk_coverage_owner` (`owner_task_id`),
  CONSTRAINT `fk_coverage_owner` FOREIGN KEY (`owner_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_coverage_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_coverage_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_coverage_status` CHECK ((`status` in (_utf8mb4'planned',_utf8mb4'in_progress',_utf8mb4'blocked',_utf8mb4'covered',_utf8mb4'candidate',_utf8mb4'not_applicable',_utf8mb4'out_of_scope',_utf8mb4'deferred')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_decision
-- ----------------------------
DROP TABLE IF EXISTS `audit_decision`;
CREATE TABLE `audit_decision` (
  `decision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decision_no` int unsigned NOT NULL,
  `decision` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `record_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `material_change` tinyint(1) NOT NULL DEFAULT '0',
  `supersedes_decision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `decided_at` datetime(6) NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`decision_id`),
  UNIQUE KEY `uq_decision_no` (`validation_id`,`decision_no`),
  KEY `fk_decision_payload` (`record_payload_id`),
  KEY `fk_decision_supersedes` (`supersedes_decision_id`),
  CONSTRAINT `fk_decision_payload` FOREIGN KEY (`record_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_decision_supersedes` FOREIGN KEY (`supersedes_decision_id`) REFERENCES `audit_decision` (`decision_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_decision_validation` FOREIGN KEY (`validation_id`) REFERENCES `audit_validation` (`validation_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_decision_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_decision_value` CHECK ((`decision` in (_utf8mb4'confirmed',_utf8mb4'needs_validation',_utf8mb4'rejected',_utf8mb4'verified',_utf8mb4'replace')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_event
-- ----------------------------
DROP TABLE IF EXISTS `audit_event`;
CREATE TABLE `audit_event` (
  `event_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `phase_execution_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `event_type` varchar(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `actor_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `agent_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `correlation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `causation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `idempotency_key` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `idempotency_hash` binary(32) NOT NULL,
  `payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `source_refs_json` json NOT NULL,
  `envelope_sha256` binary(32) NOT NULL,
  `occurred_at` datetime(6) NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`event_id`),
  UNIQUE KEY `uq_event_idempotency` (`run_id`,`idempotency_hash`),
  KEY `ix_event_timeline` (`run_id`,`occurred_at`,`event_id`),
  KEY `ix_event_type` (`run_id`,`event_type`,`occurred_at`),
  KEY `fk_event_phase` (`phase_execution_id`),
  KEY `fk_event_payload` (`payload_id`),
  KEY `fk_event_cause` (`causation_id`),
  KEY `fk_event_task` (`agent_task_id`),
  CONSTRAINT `fk_event_cause` FOREIGN KEY (`causation_id`) REFERENCES `audit_event` (`event_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_event_payload` FOREIGN KEY (`payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_event_phase` FOREIGN KEY (`phase_execution_id`) REFERENCES `audit_phase_execution` (`phase_execution_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_event_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_event_task` FOREIGN KEY (`agent_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_event_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_evidence
-- ----------------------------
DROP TABLE IF EXISTS `audit_evidence`;
CREATE TABLE `audit_evidence` (
  `evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `producer_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `evidence_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `repo_path` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `start_line` int unsigned DEFAULT NULL,
  `end_line` int unsigned DEFAULT NULL,
  `scope_name` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `artifact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `tool_execution_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `evidence_sha256` binary(32) NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`evidence_id`),
  KEY `ix_evidence_path` (`run_id`,`start_line`),
  KEY `fk_evidence_task` (`producer_task_id`),
  KEY `fk_evidence_artifact` (`artifact_id`),
  KEY `fk_evidence_tool` (`tool_execution_id`),
  KEY `fk_evidence_payload` (`payload_id`),
  CONSTRAINT `fk_evidence_artifact` FOREIGN KEY (`artifact_id`) REFERENCES `audit_artifact` (`artifact_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_evidence_payload` FOREIGN KEY (`payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_evidence_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_evidence_task` FOREIGN KEY (`producer_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_evidence_tool` FOREIGN KEY (`tool_execution_id`) REFERENCES `audit_tool_execution` (`tool_execution_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_evidence_lines` CHECK ((((`start_line` is null) and (`end_line` is null)) or ((`start_line` >= 1) and (`end_line` >= `start_line`)))),
  CONSTRAINT `chk_evidence_locator` CHECK (((`repo_path` is not null) or (`artifact_id` is not null) or (`tool_execution_id` is not null) or (`payload_id` is not null))),
  CONSTRAINT `chk_evidence_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_finding
-- ----------------------------
DROP TABLE IF EXISTS `audit_finding`;
CREATE TABLE `audit_finding` (
  `finding_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `fingerprint` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `fingerprint_hash` binary(32) NOT NULL,
  `current_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `current_verdict` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `row_version` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`finding_id`),
  UNIQUE KEY `uq_finding_fingerprint` (`run_id`,`fingerprint_hash`),
  KEY `fk_finding_candidate` (`candidate_id`),
  KEY `fk_finding_current_revision` (`finding_id`,`current_revision_id`),
  CONSTRAINT `fk_finding_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `audit_candidate` (`candidate_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_finding_current_revision` FOREIGN KEY (`finding_id`, `current_revision_id`) REFERENCES `audit_finding_revision` (`finding_id`, `finding_revision_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_finding_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_finding_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_finding_status` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'independently_decided',_utf8mb4'final_verified',_utf8mb4'replaced',_utf8mb4'removed'))),
  CONSTRAINT `chk_finding_verdict` CHECK ((`current_verdict` in (_utf8mb4'confirmed',_utf8mb4'needs_validation',_utf8mb4'rejected')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_finding_coverage
-- ----------------------------
DROP TABLE IF EXISTS `audit_finding_coverage`;
CREATE TABLE `audit_finding_coverage` (
  `finding_coverage_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `finding_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_unit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`finding_coverage_id`),
  UNIQUE KEY `uq_finding_coverage` (`finding_revision_id`,`coverage_unit_id`,`relation_kind`),
  UNIQUE KEY `uq_finding_coverage_order` (`finding_revision_id`,`ordinal`),
  KEY `fk_fc_coverage` (`coverage_unit_id`),
  CONSTRAINT `fk_fc_coverage` FOREIGN KEY (`coverage_unit_id`) REFERENCES `audit_coverage_unit` (`coverage_unit_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_fc_revision` FOREIGN KEY (`finding_revision_id`) REFERENCES `audit_finding_revision` (`finding_revision_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_fc_relation` CHECK ((`relation_kind` in (_utf8mb4'origin',_utf8mb4'affected',_utf8mb4'supporting'))),
  CONSTRAINT `chk_fc_source` CHECK ((`source_class` = _utf8mb4'P'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_finding_evidence
-- ----------------------------
DROP TABLE IF EXISTS `audit_finding_evidence`;
CREATE TABLE `audit_finding_evidence` (
  `finding_evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `finding_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`finding_evidence_id`),
  UNIQUE KEY `uq_finding_evidence` (`finding_revision_id`,`evidence_id`,`relation_kind`),
  UNIQUE KEY `uq_finding_evidence_order` (`finding_revision_id`,`ordinal`),
  KEY `fk_fe_evidence` (`evidence_id`),
  CONSTRAINT `fk_fe_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `audit_evidence` (`evidence_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_fe_revision` FOREIGN KEY (`finding_revision_id`) REFERENCES `audit_finding_revision` (`finding_revision_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_fe_relation` CHECK ((`relation_kind` in (_utf8mb4'trace',_utf8mb4'root_cause',_utf8mb4'execution',_utf8mb4'blocker',_utf8mb4'refutation',_utf8mb4'context'))),
  CONSTRAINT `chk_fe_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_finding_revision
-- ----------------------------
DROP TABLE IF EXISTS `audit_finding_revision`;
CREATE TABLE `audit_finding_revision` (
  `finding_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `finding_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `decision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision_no` int unsigned NOT NULL,
  `verdict` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `title` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `record_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `severity_overall` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `confidence_score` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `confidence_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `severity_likelihood` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `severity_impact` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `supersedes_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `change_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`finding_revision_id`),
  UNIQUE KEY `uq_finding_revision` (`finding_id`,`revision_no`),
  UNIQUE KEY `uq_finding_revision_owner` (`finding_id`,`finding_revision_id`),
  KEY `fk_fr_decision` (`decision_id`),
  KEY `fk_fr_payload` (`record_payload_id`),
  KEY `fk_fr_supersedes` (`supersedes_revision_id`),
  CONSTRAINT `fk_fr_decision` FOREIGN KEY (`decision_id`) REFERENCES `audit_decision` (`decision_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_fr_finding` FOREIGN KEY (`finding_id`) REFERENCES `audit_finding` (`finding_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_fr_payload` FOREIGN KEY (`record_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_fr_supersedes` FOREIGN KEY (`supersedes_revision_id`) REFERENCES `audit_finding_revision` (`finding_revision_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_fr_confidence` CHECK (((`confidence_score` is null) or (`confidence_score` in (_utf8mb4'low',_utf8mb4'medium',_utf8mb4'high')))),
  CONSTRAINT `chk_fr_severity` CHECK ((((`verdict` = _utf8mb4'confirmed') and (`severity_overall` in (_utf8mb4'informational',_utf8mb4'low',_utf8mb4'medium',_utf8mb4'high',_utf8mb4'critical'))) or ((`verdict` <> _utf8mb4'confirmed') and (`severity_overall` is null)))),
  CONSTRAINT `chk_fr_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_fr_status` CHECK ((`status` in (_utf8mb4'draft',_utf8mb4'independently_decided',_utf8mb4'final_verified',_utf8mb4'replaced',_utf8mb4'removed'))),
  CONSTRAINT `chk_fr_verdict` CHECK ((`verdict` in (_utf8mb4'confirmed',_utf8mb4'needs_validation',_utf8mb4'rejected')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_human_adjudication
-- ----------------------------
DROP TABLE IF EXISTS `audit_human_adjudication`;
CREATE TABLE `audit_human_adjudication` (
  `adjudication_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `subject_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `label_scheme` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `hypothesis_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `finding_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `adjudicator_pseudonym` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `label` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `rationale` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `evidence_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `eligible_for_metrics` tinyint(1) NOT NULL DEFAULT '0',
  `adjudicated_at` datetime(6) NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`adjudication_id`),
  KEY `ix_adjudication_hypothesis` (`hypothesis_id`,`adjudicated_at`),
  KEY `ix_adjudication_candidate` (`candidate_id`,`adjudicated_at`),
  KEY `ix_adjudication_finding` (`finding_id`,`adjudicated_at`),
  KEY `fk_adjudication_run` (`run_id`),
  KEY `fk_adjudication_payload` (`evidence_payload_id`),
  CONSTRAINT `fk_adjudication_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `audit_candidate` (`candidate_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_adjudication_finding` FOREIGN KEY (`finding_id`) REFERENCES `audit_finding` (`finding_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_adjudication_hypothesis` FOREIGN KEY (`hypothesis_id`) REFERENCES `audit_hypothesis` (`hypothesis_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_adjudication_payload` FOREIGN KEY (`evidence_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_adjudication_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_adjudication_label` CHECK ((((`subject_type` = _utf8mb4'hypothesis') and (`label_scheme` = _utf8mb4'hypothesis_match_v1') and (`label` in (_utf8mb4'exact_match',_utf8mb4'partial_match',_utf8mb4'wrong_hypothesis',_utf8mb4'unresolved'))) or ((`subject_type` in (_utf8mb4'candidate',_utf8mb4'finding')) and (`label_scheme` = _utf8mb4'security_validity_v1') and (`label` in (_utf8mb4'true_positive',_utf8mb4'false_positive',_utf8mb4'indeterminate'))))),
  CONSTRAINT `chk_adjudication_source` CHECK ((`source_class` in (_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_adjudication_subject` CHECK ((((`subject_type` = _utf8mb4'hypothesis') and (`hypothesis_id` is not null) and (`candidate_id` is null) and (`finding_id` is null)) or ((`subject_type` = _utf8mb4'candidate') and (`hypothesis_id` is null) and (`candidate_id` is not null) and (`finding_id` is null)) or ((`subject_type` = _utf8mb4'finding') and (`hypothesis_id` is null) and (`candidate_id` is null) and (`finding_id` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_hypothesis
-- ----------------------------
DROP TABLE IF EXISTS `audit_hypothesis`;
CREATE TABLE `audit_hypothesis` (
  `hypothesis_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_unit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creator_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `local_hypothesis_key` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `current_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `row_version` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`hypothesis_id`),
  UNIQUE KEY `uq_hypothesis_local` (`run_id`,`creator_task_id`,`local_hypothesis_key`),
  KEY `ix_hypothesis_status` (`run_id`,`status`),
  KEY `fk_hypothesis_coverage` (`coverage_unit_id`),
  KEY `fk_hypothesis_creator` (`creator_task_id`),
  KEY `fk_hypothesis_current_version` (`hypothesis_id`,`current_version_id`),
  CONSTRAINT `fk_hypothesis_coverage` FOREIGN KEY (`coverage_unit_id`) REFERENCES `audit_coverage_unit` (`coverage_unit_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hypothesis_creator` FOREIGN KEY (`creator_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hypothesis_current_version` FOREIGN KEY (`hypothesis_id`, `current_version_id`) REFERENCES `audit_hypothesis_version` (`hypothesis_id`, `hypothesis_version_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hypothesis_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_hypothesis_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_hypothesis_status` CHECK ((`status` in (_utf8mb4'proposed',_utf8mb4'investigating',_utf8mb4'candidate',_utf8mb4'confirmed',_utf8mb4'rejected',_utf8mb4'needs_validation',_utf8mb4'abandoned',_utf8mb4'superseded',_utf8mb4'merged',_utf8mb4'split')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_hypothesis_coverage
-- ----------------------------
DROP TABLE IF EXISTS `audit_hypothesis_coverage`;
CREATE TABLE `audit_hypothesis_coverage` (
  `hypothesis_coverage_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hypothesis_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `coverage_unit_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`hypothesis_coverage_id`),
  UNIQUE KEY `uq_hypothesis_coverage` (`hypothesis_id`,`coverage_unit_id`,`relation_kind`),
  UNIQUE KEY `uq_hypothesis_coverage_order` (`hypothesis_id`,`ordinal`),
  KEY `fk_hc_coverage` (`coverage_unit_id`),
  CONSTRAINT `fk_hc_coverage` FOREIGN KEY (`coverage_unit_id`) REFERENCES `audit_coverage_unit` (`coverage_unit_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hc_hypothesis` FOREIGN KEY (`hypothesis_id`) REFERENCES `audit_hypothesis` (`hypothesis_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_hc_relation` CHECK ((`relation_kind` in (_utf8mb4'primary',_utf8mb4'supporting',_utf8mb4'affected'))),
  CONSTRAINT `chk_hc_source` CHECK ((`source_class` = _utf8mb4'P'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_hypothesis_evidence
-- ----------------------------
DROP TABLE IF EXISTS `audit_hypothesis_evidence`;
CREATE TABLE `audit_hypothesis_evidence` (
  `hypothesis_evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hypothesis_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation_kind` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `weight` decimal(6,5) DEFAULT NULL,
  `rationale` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`hypothesis_evidence_id`),
  UNIQUE KEY `uq_hypothesis_evidence` (`hypothesis_version_id`,`evidence_id`,`relation_kind`),
  KEY `fk_he_evidence` (`evidence_id`),
  CONSTRAINT `fk_he_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `audit_evidence` (`evidence_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_he_version` FOREIGN KEY (`hypothesis_version_id`) REFERENCES `audit_hypothesis_version` (`hypothesis_version_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_he_relation` CHECK ((`relation_kind` in (_utf8mb4'supports',_utf8mb4'refutes',_utf8mb4'context',_utf8mb4'unknown'))),
  CONSTRAINT `chk_he_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_he_weight` CHECK (((`weight` is null) or (`weight` between 0 and 1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_hypothesis_relation
-- ----------------------------
DROP TABLE IF EXISTS `audit_hypothesis_relation`;
CREATE TABLE `audit_hypothesis_relation` (
  `hypothesis_relation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `from_hypothesis_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `to_hypothesis_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `relation_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `event_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `rationale` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`hypothesis_relation_id`),
  UNIQUE KEY `uq_hypothesis_relation` (`from_hypothesis_id`,`to_hypothesis_id`,`relation_kind`),
  KEY `ix_hypothesis_relation_to` (`to_hypothesis_id`,`relation_kind`),
  KEY `fk_hr_run` (`run_id`),
  KEY `fk_hr_event` (`event_id`),
  CONSTRAINT `fk_hr_event` FOREIGN KEY (`event_id`) REFERENCES `audit_event` (`event_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hr_from` FOREIGN KEY (`from_hypothesis_id`) REFERENCES `audit_hypothesis` (`hypothesis_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hr_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hr_to` FOREIGN KEY (`to_hypothesis_id`) REFERENCES `audit_hypothesis` (`hypothesis_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_hr_distinct` CHECK ((`from_hypothesis_id` <> `to_hypothesis_id`)),
  CONSTRAINT `chk_hr_kind` CHECK ((`relation_kind` in (_utf8mb4'supersedes',_utf8mb4'merged_into',_utf8mb4'split_from',_utf8mb4'alternative_to'))),
  CONSTRAINT `chk_hr_source` CHECK ((`source_class` = _utf8mb4'P'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_hypothesis_score
-- ----------------------------
DROP TABLE IF EXISTS `audit_hypothesis_score`;
CREATE TABLE `audit_hypothesis_score` (
  `hypothesis_score_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hypothesis_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `score_no` int unsigned NOT NULL,
  `scorer_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `predicted_probability` decimal(6,5) NOT NULL,
  `probability_rationale` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `potential_impact` decimal(6,5) NOT NULL,
  `coverage_value` decimal(6,5) NOT NULL,
  `information_gain` decimal(6,5) NOT NULL,
  `estimated_validation_cost` decimal(12,4) NOT NULL,
  `validation_cost_unit` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `estimated_duration_ms` bigint unsigned DEFAULT NULL,
  `estimated_agent_calls` decimal(12,4) DEFAULT NULL,
  `estimated_token_count` bigint unsigned DEFAULT NULL,
  `priority_score` decimal(12,6) NOT NULL,
  `formula_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `formula_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `scoring_protocol` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `scoring_protocol_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `model_config_sha256` binary(32) DEFAULT NULL,
  `prompt_template_sha256` binary(32) DEFAULT NULL,
  `evidence_as_of_event_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scored_at` datetime(6) NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`hypothesis_score_id`),
  UNIQUE KEY `uq_hypothesis_score` (`hypothesis_version_id`,`score_no`),
  KEY `fk_hs_scorer` (`scorer_task_id`),
  KEY `fk_hs_evidence_cutoff` (`evidence_as_of_event_id`),
  CONSTRAINT `fk_hs_evidence_cutoff` FOREIGN KEY (`evidence_as_of_event_id`) REFERENCES `audit_event` (`event_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hs_scorer` FOREIGN KEY (`scorer_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hs_version` FOREIGN KEY (`hypothesis_version_id`) REFERENCES `audit_hypothesis_version` (`hypothesis_version_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_hs_components` CHECK ((((`estimated_duration_ms` is null) or (`estimated_duration_ms` >= 0)) and ((`estimated_agent_calls` is null) or (`estimated_agent_calls` >= 0)))),
  CONSTRAINT `chk_hs_cost` CHECK ((`estimated_validation_cost` >= 0)),
  CONSTRAINT `chk_hs_cost_unit` CHECK ((`validation_cost_unit` in (_utf8mb4'normalized',_utf8mb4'milliseconds',_utf8mb4'agent_calls',_utf8mb4'tokens',_utf8mb4'currency'))),
  CONSTRAINT `chk_hs_coverage` CHECK ((`coverage_value` between 0 and 1)),
  CONSTRAINT `chk_hs_impact` CHECK ((`potential_impact` between 0 and 1)),
  CONSTRAINT `chk_hs_info` CHECK ((`information_gain` between 0 and 1)),
  CONSTRAINT `chk_hs_probability` CHECK ((`predicted_probability` between 0 and 1)),
  CONSTRAINT `chk_hs_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_hypothesis_version
-- ----------------------------
DROP TABLE IF EXISTS `audit_hypothesis_version`;
CREATE TABLE `audit_hypothesis_version` (
  `hypothesis_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `hypothesis_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `version_no` int unsigned NOT NULL,
  `author_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attacker_principal` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `attacker_capabilities` json NOT NULL,
  `controlled_input` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `entrypoint` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `expected_invariant` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `suspected_control_failure` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `predicted_trace` json NOT NULL,
  `target_boundary` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `affected_resource` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `predicted_result` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `preconditions_json` json NOT NULL,
  `unknown_facts_json` json NOT NULL,
  `alternative_explanations_json` json NOT NULL,
  `revision_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`hypothesis_version_id`),
  UNIQUE KEY `uq_hypothesis_version` (`hypothesis_id`,`version_no`),
  UNIQUE KEY `uq_hypothesis_version_owner` (`hypothesis_id`,`hypothesis_version_id`),
  KEY `fk_hv_author` (`author_task_id`),
  CONSTRAINT `fk_hv_author` FOREIGN KEY (`author_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hv_hypothesis` FOREIGN KEY (`hypothesis_id`) REFERENCES `audit_hypothesis` (`hypothesis_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_hv_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_payload
-- ----------------------------
DROP TABLE IF EXISTS `audit_payload`;
CREATE TABLE `audit_payload` (
  `payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload_type` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `mime_type` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `content_json` json DEFAULT NULL,
  `content_text` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `content_sha256` binary(32) DEFAULT NULL,
  `stored_bytes` int unsigned NOT NULL,
  `original_bytes` bigint unsigned NOT NULL,
  `original_fingerprint_hmac` binary(32) DEFAULT NULL,
  `fingerprint_key_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_truncated` tinyint(1) NOT NULL DEFAULT '0',
  `redaction_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `redaction_profile` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `redaction_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `sensitivity` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `retention_policy` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `retain_until` datetime(6) DEFAULT NULL,
  `purged_at` datetime(6) DEFAULT NULL,
  `purge_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`payload_id`),
  KEY `ix_payload_retention` (`retain_until`,`purged_at`),
  KEY `ix_payload_hash` (`content_sha256`),
  KEY `fk_payload_run` (`run_id`),
  CONSTRAINT `fk_payload_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_payload_body` CHECK ((((`redaction_status` in (_utf8mb4'passed',_utf8mb4'redacted')) and ((`content_json` is not null) <> (`content_text` is not null)) and (`content_sha256` is not null) and (`stored_bytes` > 0)) or ((`redaction_status` in (_utf8mb4'blocked',_utf8mb4'metadata_only')) and (`content_json` is null) and (`content_text` is null) and (`content_sha256` is null) and (`stored_bytes` = 0)))),
  CONSTRAINT `chk_payload_fingerprint` CHECK ((((`original_fingerprint_hmac` is null) and (`fingerprint_key_version` is null)) or ((`original_fingerprint_hmac` is not null) and (`fingerprint_key_version` is not null)))),
  CONSTRAINT `chk_payload_redaction` CHECK ((`redaction_status` in (_utf8mb4'passed',_utf8mb4'redacted',_utf8mb4'blocked',_utf8mb4'metadata_only'))),
  CONSTRAINT `chk_payload_sensitivity` CHECK ((`sensitivity` in (_utf8mb4'public',_utf8mb4'internal',_utf8mb4'sensitive',_utf8mb4'restricted'))),
  CONSTRAINT `chk_payload_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_phase_execution
-- ----------------------------
DROP TABLE IF EXISTS `audit_phase_execution`;
CREATE TABLE `audit_phase_execution` (
  `phase_execution_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `phase_code` varchar(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attempt_no` int unsigned NOT NULL DEFAULT '1',
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `input_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `output_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `failure_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `started_at` datetime(6) DEFAULT NULL,
  `ended_at` datetime(6) DEFAULT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`phase_execution_id`),
  UNIQUE KEY `uq_phase_attempt` (`run_id`,`phase_code`,`attempt_no`),
  KEY `fk_phase_input` (`input_payload_id`),
  KEY `fk_phase_output` (`output_payload_id`),
  CONSTRAINT `fk_phase_input` FOREIGN KEY (`input_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_phase_output` FOREIGN KEY (`output_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_phase_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_phase_code` CHECK ((`phase_code` in (_ascii'P0',_ascii'P1',_ascii'P2',_ascii'P3',_ascii'P4',_ascii'P5',_ascii'P6',_ascii'POST'))),
  CONSTRAINT `chk_phase_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_phase_status` CHECK ((`status` in (_utf8mb4'pending',_utf8mb4'running',_utf8mb4'completed',_utf8mb4'skipped',_utf8mb4'failed',_utf8mb4'incomplete')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_recon_fact
-- ----------------------------
DROP TABLE IF EXISTS `audit_recon_fact`;
CREATE TABLE `audit_recon_fact` (
  `recon_fact_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recon_kind` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `fact_kind` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `statement` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `evidence_strength` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `unknown_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `accepted_by_parent` tinyint(1) NOT NULL DEFAULT '0',
  `included_in_architecture` tinyint(1) NOT NULL DEFAULT '0',
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`recon_fact_id`),
  KEY `ix_recon_kind` (`run_id`,`recon_kind`,`fact_kind`),
  KEY `fk_recon_task` (`task_id`),
  KEY `fk_recon_evidence` (`evidence_id`),
  CONSTRAINT `fk_recon_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `audit_evidence` (`evidence_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_recon_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_recon_task` FOREIGN KEY (`task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_recon_fact_kind` CHECK ((`fact_kind` in (_utf8mb4'source_fact',_utf8mb4'inference',_utf8mb4'unknown'))),
  CONSTRAINT `chk_recon_kind` CHECK ((`recon_kind` in (_utf8mb4'product_stack',_utf8mb4'principals_controls',_utf8mb4'surfaces_sinks',_utf8mb4'execution_visibility',_utf8mb4'focused'))),
  CONSTRAINT `chk_recon_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_recon_strength` CHECK ((`evidence_strength` in (_utf8mb4'direct',_utf8mb4'corroborated',_utf8mb4'indirect',_utf8mb4'none')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_run
-- ----------------------------
DROP TABLE IF EXISTS `audit_run`;
CREATE TABLE `audit_run` (
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_idempotency_key` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `request_idempotency_hash` binary(32) DEFAULT NULL,
  `repo` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `target_locator_redacted` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `target_locator_policy` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'relative_or_pseudonymized',
  `source_ref` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `worktree_dirty` tinyint(1) NOT NULL DEFAULT '0',
  `profile` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `budget` int unsigned DEFAULT NULL,
  `execution_policy` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `skill_manifest_sha256` binary(32) NOT NULL,
  `skill_schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `telemetry_mode` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `telemetry_failure_policy` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `run_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `telemetry_local_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `telemetry_remote_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `outbox_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `incomplete_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `telemetry_incomplete_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `started_at` datetime(6) DEFAULT NULL,
  `ended_at` datetime(6) DEFAULT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `row_version` bigint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`run_id`),
  UNIQUE KEY `uq_run_request_idempotency` (`request_idempotency_hash`),
  KEY `ix_run_repo_status` (`repo`,`run_status`,`created_at`),
  CONSTRAINT `chk_run_failure_policy` CHECK ((`telemetry_failure_policy` in (_utf8mb4'best_effort',_utf8mb4'required'))),
  CONSTRAINT `chk_run_local_status` CHECK ((`telemetry_local_status` in (_utf8mb4'disabled',_utf8mb4'healthy',_utf8mb4'degraded',_utf8mb4'incomplete'))),
  CONSTRAINT `chk_run_outbox` CHECK ((`outbox_status` in (_utf8mb4'empty',_utf8mb4'pending',_utf8mb4'replaying',_utf8mb4'blocked',_utf8mb4'disabled'))),
  CONSTRAINT `chk_run_profile` CHECK ((`profile` in (_utf8mb4'quick',_utf8mb4'standard',_utf8mb4'deep'))),
  CONSTRAINT `chk_run_remote_status` CHECK ((`telemetry_remote_status` in (_utf8mb4'disabled',_utf8mb4'pending_sync',_utf8mb4'syncing',_utf8mb4'synced',_utf8mb4'incomplete'))),
  CONSTRAINT `chk_run_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_run_status` CHECK ((`run_status` in (_utf8mb4'initializing',_utf8mb4'in_progress',_utf8mb4'complete',_utf8mb4'incomplete',_utf8mb4'failed',_utf8mb4'cancelled'))),
  CONSTRAINT `chk_run_telemetry_mode` CHECK ((`telemetry_mode` in (_utf8mb4'off',_utf8mb4'local',_utf8mb4'remote')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_run_scope
-- ----------------------------
DROP TABLE IF EXISTS `audit_run_scope`;
CREATE TABLE `audit_run_scope` (
  `scope_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `scope_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `scope_value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `included` tinyint(1) NOT NULL,
  `reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`scope_id`),
  UNIQUE KEY `uq_scope_order` (`run_id`,`ordinal`),
  CONSTRAINT `fk_scope_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_scope_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_schema_version
-- ----------------------------
DROP TABLE IF EXISTS `audit_schema_version`;
CREATE TABLE `audit_schema_version` (
  `version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `ddl_sha256` binary(32) NOT NULL,
  `description` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'P',
  `applied_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`version`),
  CONSTRAINT `chk_asv_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_tool_execution
-- ----------------------------
DROP TABLE IF EXISTS `audit_tool_execution`;
CREATE TABLE `audit_tool_execution` (
  `tool_execution_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `run_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `tool_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `tool_version` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `invocation_kind` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `command_summary` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `input_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `output_payload_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `sandbox_policy` json DEFAULT NULL,
  `exit_code` int DEFAULT NULL,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `started_at` datetime(6) DEFAULT NULL,
  `ended_at` datetime(6) DEFAULT NULL,
  `wall_duration_ms` bigint unsigned DEFAULT NULL,
  `cpu_time_ms` bigint unsigned DEFAULT NULL,
  `peak_memory_bytes` bigint unsigned DEFAULT NULL,
  `stdout_bytes` bigint unsigned DEFAULT NULL,
  `stderr_bytes` bigint unsigned DEFAULT NULL,
  `timed_out` tinyint(1) NOT NULL DEFAULT '0',
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`tool_execution_id`),
  KEY `ix_tool_task` (`task_id`,`started_at`),
  KEY `fk_tool_run` (`run_id`),
  KEY `fk_tool_input` (`input_payload_id`),
  KEY `fk_tool_output` (`output_payload_id`),
  CONSTRAINT `fk_tool_input` FOREIGN KEY (`input_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_tool_output` FOREIGN KEY (`output_payload_id`) REFERENCES `audit_payload` (`payload_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_tool_run` FOREIGN KEY (`run_id`) REFERENCES `audit_run` (`run_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_tool_task` FOREIGN KEY (`task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_tool_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_tool_status` CHECK ((`status` in (_utf8mb4'planned',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'blocked',_utf8mb4'skipped')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_validation
-- ----------------------------
DROP TABLE IF EXISTS `audit_validation`;
CREATE TABLE `audit_validation` (
  `validation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `candidate_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `input_hypothesis_version_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `input_finding_revision_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `input_sha256` binary(32) NOT NULL,
  `validation_no` int unsigned NOT NULL,
  `phase_code` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `verifier_task_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validation_kind` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `independence_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `method_summary` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `strongest_control` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `started_at` datetime(6) DEFAULT NULL,
  `ended_at` datetime(6) DEFAULT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`validation_id`),
  UNIQUE KEY `uq_validation_no` (`candidate_id`,`validation_no`),
  KEY `fk_validation_hv` (`input_hypothesis_version_id`),
  KEY `fk_validation_verifier` (`verifier_task_id`),
  KEY `fk_validation_finding_revision` (`input_finding_revision_id`),
  CONSTRAINT `fk_validation_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `audit_candidate` (`candidate_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_validation_finding_revision` FOREIGN KEY (`input_finding_revision_id`) REFERENCES `audit_finding_revision` (`finding_revision_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_validation_hv` FOREIGN KEY (`input_hypothesis_version_id`) REFERENCES `audit_hypothesis_version` (`hypothesis_version_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_validation_verifier` FOREIGN KEY (`verifier_task_id`) REFERENCES `audit_agent_task` (`task_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_validation_independence` CHECK ((`independence_status` in (_utf8mb4'passed',_utf8mb4'failed',_utf8mb4'unavailable'))),
  CONSTRAINT `chk_validation_input` CHECK ((((`phase_code` = _utf8mb4'P3') and (`input_hypothesis_version_id` is not null) and (`input_finding_revision_id` is null)) or ((`phase_code` = _utf8mb4'P5') and (`input_finding_revision_id` is not null)))),
  CONSTRAINT `chk_validation_phase` CHECK ((`phase_code` in (_utf8mb4'P3',_utf8mb4'P5'))),
  CONSTRAINT `chk_validation_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D'))),
  CONSTRAINT `chk_validation_status` CHECK ((`status` in (_utf8mb4'queued',_utf8mb4'running',_utf8mb4'succeeded',_utf8mb4'failed',_utf8mb4'discarded',_utf8mb4'deferred')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Table structure for audit_validation_observation
-- ----------------------------
DROP TABLE IF EXISTS `audit_validation_observation`;
CREATE TABLE `audit_validation_observation` (
  `validation_observation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `validation_id` char(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `ordinal` int unsigned NOT NULL,
  `observation_kind` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `expected_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `observed_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `relation_to_claim` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `evidence_id` char(26) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `schema_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `source_class` char(1) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`validation_observation_id`),
  UNIQUE KEY `uq_validation_observation` (`validation_id`,`ordinal`),
  KEY `fk_vo_evidence` (`evidence_id`),
  CONSTRAINT `fk_vo_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `audit_evidence` (`evidence_id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vo_validation` FOREIGN KEY (`validation_id`) REFERENCES `audit_validation` (`validation_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_vo_relation` CHECK ((`relation_to_claim` in (_utf8mb4'supports',_utf8mb4'refutes',_utf8mb4'neutral',_utf8mb4'unresolved'))),
  CONSTRAINT `chk_vo_source` CHECK ((`source_class` in (_utf8mb4'S',_utf8mb4'O',_utf8mb4'P',_utf8mb4'D')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;
