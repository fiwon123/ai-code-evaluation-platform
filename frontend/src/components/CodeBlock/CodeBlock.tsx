import { useCallback, useState } from "react";
import styles from "./CodeBlock.module.css";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
}

function CodeBlock({ code, language = "", filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className={styles.block}>
      <div className={styles.header}>
        <span>{filename ?? (language ? `language: ${language}` : "code")}</span>
        <button
          type="button"
          className={`${styles.copyButton} ${copied ? styles.copied : ""}`}
          onClick={() => void handleCopy()}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className={styles.code}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default CodeBlock;