import { useState, type FormEvent } from "react";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import {
  Field,
  TextAreaInput,
  TextInput,
  useFieldId,
} from "../../components/Input/Input.tsx";
import styles from "./Contact.module.css";

function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const nameId = useFieldId("name");
  const emailId = useFieldId("email");
  const companyId = useFieldId("company");
  const messageId = useFieldId("message");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <span className="eyebrow">Contact</span>
        <PageTitle size="lg" className={styles.title}>Get in touch</PageTitle>
        <p className={styles.subtitle}>
          Questions about the platform, enterprise pricing, or contributing?
          We'd love to hear from you.
        </p>
      </div>

      <div className={styles.columns}>
        <Card className={styles.formCard}>
          {submitted ? (
            <div className={styles.success}>
              <div className={styles.successIcon}>✅</div>
              <h2 className={styles.successTitle}>Message received!</h2>
              <p className={styles.successText}>
                Thanks {name || "there"} — we'll get back to you at{" "}
                {email || "your email"} shortly.
              </p>
              <Button
                variant="secondary"
                onClick={() => setSubmitted(false)}
                className={styles.successButton}
              >
                Send another message
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.formRow}>
                <Field label="Name" id={nameId}>
                  <TextInput
                    id={nameId}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    placeholder="Jane Doe"
                  />
                </Field>
                <Field label="Email" id={emailId}>
                  <TextInput
                    id={emailId}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="jane@company.com"
                  />
                </Field>
              </div>
              <Field label="Company (optional)" id={companyId}>
                <TextInput
                  id={companyId}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  autoComplete="organization"
                  placeholder="Acme Inc."
                />
              </Field>
              <Field label="Message" id={messageId}>
                <TextAreaInput
                  id={messageId}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  rows={5}
                  placeholder="Tell us how we can help…"
                />
              </Field>
              <Button type="submit" size="lg" className={styles.submit}>
                Send message
              </Button>
            </form>
          )}
        </Card>

        <div className={styles.infoCol}>
          <Card className={styles.infoCard}>
            <h2 className={styles.infoTitle}>Contact info</h2>
            <ul className={styles.infoList}>
              <li>
                <span className={styles.infoLabel}>Email</span>
                <a href="mailto:hello@aicodeval.dev" className={styles.infoValue}>
                  hello@aicodeval.dev
                </a>
              </li>
              <li>
                <span className={styles.infoLabel}>GitHub</span>
                <a
                  href="https://github.com/fiwon123/ai-code-evaluation-platform"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.infoValue}
                >
                  fiwon123/ai-code-evaluation-platform
                </a>
              </li>
              <li>
                <span className={styles.infoLabel}>Project status</span>
                <span className={styles.infoValue}>
                  Open source · actively developed
                </span>
              </li>
            </ul>
          </Card>

          <Card className={styles.infoCard}>
            <h2 className={styles.infoTitle}>Looking for help?</h2>
            <ul className={styles.infoList}>
              <li>
                <a href="/demo" className={styles.infoLink}>
                  Try the live demo
                </a>
              </li>
              <li>
                <a href="/challenges" className={styles.infoLink}>
                  Browse challenges
                </a>
              </li>
              <li>
                <a href="/pricing" className={styles.infoLink}>
                  See pricing plans
                </a>
              </li>
            </ul>
          </Card>

          <Card className={styles.infoCard}>
            <h2 className={styles.infoTitle}>Sales & partnerships</h2>
            <p className={styles.infoText}>
              Interested in using the platform at your company or building on
              it? Reach out and we'll set up a call.
            </p>
            <a href="mailto:sales@aicodeval.dev" className={styles.infoLink}>
              sales@aicodeval.dev
            </a>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default Contact;