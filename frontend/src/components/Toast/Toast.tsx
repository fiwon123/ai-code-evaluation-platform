import styles from "./Toast.module.css";

interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  onDismiss: () => void;
}

function Toast({ message, type = "info", onDismiss }: ToastProps) {
  return (
    <div
      className={`${styles.toast} ${styles[type]}`}
      role={type === "error" ? "alert" : "status"}
    >
      <span className={styles.icon} aria-hidden="true">
        {type === "success" ? "✓" : type === "error" ? "✕" : "ℹ"}
      </span>
      <span className={styles.message}>{message}</span>
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

export default Toast;