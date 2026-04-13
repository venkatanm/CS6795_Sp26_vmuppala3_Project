# Orchestrator Performance Audit

## Overview

The orchestrator manages the Tutor-Critic loop with performance monitoring and optimistic UI updates.

## Performance Targets

- **Latency Target**: < 3 seconds for Tutor + Critic loop
- **Filler Token**: Emitted if latency exceeds target
- **Background Tasks**: Architect Agent runs asynchronously (non-blocking)

## Metrics Tracked

1. **Total Time**: End-to-end response time
2. **Tutor Time**: LLM generation time
3. **Critic Time**: Evaluation time
4. **Retry Count**: Number of retries needed
5. **Latency Target Exceed Rate**: Percentage of requests exceeding 3s

## Status Updates

The orchestrator emits status updates for optimistic UI:

- `analyzing`: Initial analysis of student input
- `generating`: Tutor generating response
- `reviewing`: Critic reviewing response
- `checking`: Final validation
- `complete`: Process complete

## Usage

### Recording Metrics

```typescript
import { recordOrchestratorResult } from './orchestrator_performance';

const result = await orchestrateTutorResponse(request, config);
recordOrchestratorResult(result);
```

### Getting Audit Report

```typescript
import { auditOrchestratorPerformance, formatPerformanceReport } from './orchestrator_performance';

const audit = auditOrchestratorPerformance();
console.log(formatPerformanceReport(audit));
```

## Example Output

```
=== Orchestrator Performance Audit ===

Total Requests: 150
Average Total Time: 2450.32ms
Average Tutor Time: 1800.15ms
Average Critic Time: 450.20ms
P95 Total Time: 3200.00ms
P99 Total Time: 4500.00ms
Latency Target Exceed Rate: 12.5%
Average Retry Count: 0.8
```

## Optimization Strategies

1. **Streaming**: Use `tutorStreamCall` for faster perceived latency
2. **Filler Tokens**: Emit filler message if >3s to maintain engagement
3. **Parallel Execution**: Architect runs in background, doesn't block chat
4. **Status Updates**: Real-time UI feedback keeps user engaged

## Background Tasks

The Architect Agent runs asynchronously after the chat response:

```python
# In tutor_chat.py
asyncio.create_task(
    update_curriculum_background(session_id, user_id, db)
)
```

This ensures:
- Chat response is not blocked
- Curriculum updates happen in background
- User sees immediate feedback
