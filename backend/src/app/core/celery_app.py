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
# warning before the hard kill. The worst healthy evaluation path is ~2.5 min
# (60s LLM call + 90s Go compile/test), so 4/5 min leaves generous headroom.
celery_app.conf.task_soft_time_limit = 240
celery_app.conf.task_time_limit = 300

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
