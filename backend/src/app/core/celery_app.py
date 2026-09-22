from celery import Celery

from app.config import settings

celery_app = Celery(
    "app",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.evaluate"],
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

celery_app.autodiscover_tasks(["app"])
