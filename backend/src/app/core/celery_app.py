from celery import Celery

from app.config import settings

celery_app = Celery(
    "app",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.evaluate", "app.tasks.recover"],
)

# Reliability: tasks that time out or die with a worker are retried/requeued
# instead of being silently dropped, and stale results are reaped rather than
# accumulating in Redis forever.
celery_app.conf.task_expires = 3600  # drop tasks older than 1 hour
celery_app.conf.task_acks_late = True  # ack after execution, not on receipt
celery_app.conf.task_reject_on_worker_lost = True  # requeue on killed workers
celery_app.conf.worker_prefetch_multiplier = 1  # one task per worker at a time
celery_app.conf.broker_transport_options = {"visibility_timeout": 3600}
celery_app.conf.result_expires = 3600  # reap task result keys after 1 hour

# Hard per-task ceiling so a wedged child (hung Docker daemon, blocking Redis
# publish, ...) can't occupy a worker slot forever; the soft limit logs a
# warning before the hard kill.
#
# Derived rather than hardcoded, because the task budget has to contain the
# generation cap it protects (#272). It used to be a flat 240s/300s while a
# single Ollama generation may use `ollama_timeout` (300s), so the worker killed
# the task while the provider was still legitimately generating -- and since the
# soft limit arrives as an ordinary `Exception`, the row was recorded as an
# opaque provider error with nothing pointing at the budget. Raising
# OLLAMA_TIMEOUT above the soft limit was silently clamped for the same reason.
#
# The hosted providers hardcode a 60s client timeout (see `groq_provider.py`),
# hence the floor: the budget must clear that even if `ollama_timeout` is
# configured lower.
_MIN_GENERATION_BUDGET_S = 60

#: Worst case for the *test* leg of one attempt: `evaluate_code` applies a
#: per-language budget (java/go get extra headroom for compilation) and the
#: sandbox kills a container at `docker_timeout`.
_TEST_BUDGET_S = 90

#: Slack between the soft and hard limits, so the worker can unwind and persist
#: the result after the soft limit fires.
_HARD_LIMIT_MARGIN_S = 30

#: One attempt's generation + test worst case. Exported for the test that locks
#: the relationship, so it cannot drift back into a clamp.
GENERATION_BUDGET_S = max(settings.ollama_timeout, _MIN_GENERATION_BUDGET_S)
ATTEMPT_BUDGET_S = GENERATION_BUDGET_S + _TEST_BUDGET_S

celery_app.conf.task_soft_time_limit = ATTEMPT_BUDGET_S
celery_app.conf.task_time_limit = ATTEMPT_BUDGET_S + _HARD_LIMIT_MARGIN_S

# Periodic recovery: sweep every minute for submissions stranded in
# pending/processing (lost broker messages, expired tasks, killed workers).
# The schedule state file lives in /tmp so it never pollutes the repo, even
# though `celerybeat-schedule` is gitignored.
celery_app.conf.beat_schedule = {
    "recover-stuck-submissions": {
        "task": "app.tasks.recover.recover_stuck_submissions",
        "schedule": 60.0,
    },
}
celery_app.conf.beat_schedule_filename = "/tmp/celerybeat-schedule"

celery_app.autodiscover_tasks(["app"])
