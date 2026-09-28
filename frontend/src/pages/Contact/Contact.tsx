import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

/** Where the composer hands off. The page also lists sales@ for pricing. */
const RECIPIENT = "hello@aicodeval.dev";
const GITHUB_ISSUES =
  "https://github.com/fiwon123/ai-code-evaluation-platform/issues/new";

interface ContactFields {
  name: string;
  email: string;
  company: string;
  message: string;
}

/**
 * The message as plain text — the one artefact the user actually leaves with,
 * since nothing here reaches a server. Used for the `mailto:` body, the
 * clipboard and the GitHub-issue fallback, so all three carry identical text.
 */
function composeSubject({ name }: ContactFields) {
  return `Contact from ${name.trim() || "the website"}`;
}

function composeMessage({ name, email, company, message }: ContactFields) {
  return [
    `${name.trim() || "Someone"} wrote via the AI Code Evaluation site.`,
    "",
    `Name: ${name.trim() || "(not given)"}`,
    `Email: ${email.trim() || "(not given)"}`,
    ...(company.trim() ? [`Company: ${company.trim()}`] : []),
    "",
    message,
  ].join("\n");
}

function Contact() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  // `prepared`, not `submitted`: nothing was submitted anywhere. The old name is
  // how this page ended up telling people their message had been received.
  const [prepared, setPrepared] = useState(false);
  const [copied, setCopied] = useState(false);
  // Set when neither the async clipboard nor the legacy path worked, so the
  // text is shown for manual selection instead of failing silently.
  const [copyUnavailable, setCopyUnavailable] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameId = useFieldId("name");
  const emailId = useFieldId("email");
  const companyId = useFieldId("company");
  const messageId = useFieldId("message");

  const fields = useMemo<ContactFields>(
    () => ({ name, email, company, message }),
    [name, email, company, message],
  );
  const subject = useMemo(() => composeSubject(fields), [fields]);
  const composed = useMemo(() => composeMessage(fields), [fields]);

  // The form is replaced by the handoff panel, so move focus there: keyboard and
  // screen-reader users would otherwise be left on a removed submit button.
  useEffect(() => {
    if (prepared) headingRef.current?.focus();
  }, [prepared]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCopied(false);
    setCopyUnavailable(false);
    setPrepared(true);
  }

  function handleEdit() {
    setPrepared(false);
    setCopied(false);
    setCopyUnavailable(false);
  }

  async function handleCopy() {
    // Only claim a copy we can verify. The old `document.execCommand("copy")`
    // fallback was tempting, but it is unverifiable: in Chromium it still
    // exists and returns `true` when the async clipboard is blocked, which
    // would tell people their message was on the clipboard when it was not —
    // the same class of lie this panel replaced. If the real clipboard refuses,
    // the text is shown for manual selection instead.
    if (!navigator.clipboard?.writeText) {
      setCopied(false);
      setCopyUnavailable(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(composed);
      setCopied(true);
      setCopyUnavailable(false);
    } catch {
      setCopied(false);
      setCopyUnavailable(true);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className="eyebrow">Contact</span>
        <PageTitle size="lg" className={styles.title}>Get in touch</PageTitle>
        <p className={styles.subtitle}>
          Questions about the platform, enterprise pricing, or contributing?
          We'd love to hear from you.
        </p>
      </header>

      <div className={styles.columns}>
        <Card className={styles.formCard}>
          {prepared ? (
            <div className={styles.handoff}>
              <span className={styles.handoffIcon} aria-hidden="true">
                ✉️
              </span>
              <h2 ref={headingRef} tabIndex={-1} className={styles.handoffTitle}>
                Your message is ready — nothing has been sent yet
              </h2>
              <p className={styles.handoffText}>
                This page has no server behind it, so it can't deliver mail for
                you. It has prepared the message below; sending it is one of
                these three steps, all yours to take.
              </p>
              <ul className={styles.options}>
                <li className={styles.option}>
                  <a
                    className={styles.actionLink}
                    href={`mailto:${RECIPIENT}?subject=${encodeURIComponent(
                      subject,
                    )}&body=${encodeURIComponent(composed)}`}
                  >
                    Open it in your email app
                  </a>
                  <span className={styles.optionHint}>
                    Opens a draft addressed to {RECIPIENT} with the subject and
                    message filled in. Nothing leaves until you press send
                    there.
                  </span>
                </li>
                <li className={styles.option}>
                  <Button variant="secondary" onClick={handleCopy}>
                    Copy the message
                  </Button>
                  <span className={styles.optionHint}>
                    Paste it into any channel you already use.
                  </span>
                  {copied && (
                    <span className={styles.copyStatus} role="status">
                      Copied to your clipboard.
                    </span>
                  )}
                  {copyUnavailable && (
                    <span className={styles.copyStatus} role="status">
                      This browser wouldn't let the page copy for you — select
                      the text below and copy it manually.
                    </span>
                  )}
                </li>
                <li className={styles.option}>
                  <a
                    className={styles.optionLink}
                    href={`${GITHUB_ISSUES}?title=${encodeURIComponent(
                      subject,
                    )}&body=${encodeURIComponent(composed)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Post it as a GitHub issue
                  </a>
                  <span className={styles.optionHint}>
                    No email app on this machine? This opens a new issue with
                    the text ready to paste.
                  </span>
                </li>
              </ul>
              <p className={styles.handoffNote}>
                Replies go to the address your email app is signed in with, so
                the address you typed is in the message body rather than the
                reply-to field.
              </p>
              {copyUnavailable && (
                <textarea
                  id="contact-message-fallback"
                  name="message"
                  className={styles.fallback}
                  aria-label="Your message, ready to copy"
                  readOnly
                  rows={8}
                  value={composed}
                />
              )}
              <Button variant="ghost" onClick={handleEdit} className={styles.editButton}>
                Edit the message
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
                Prepare message
              </Button>
              <p className={styles.formHint}>
                Nothing is sent from this page. The next step hands the message
                to your own email app, or lets you copy it.
              </p>
            </form>
          )}
        </Card>

        <div className={styles.infoCol}>
          <Card className={styles.infoCard}>
            <h2 className={styles.infoTitle}>Contact info</h2>
            <ul className={styles.infoList}>
              <li>
                <span className={styles.infoLabel}>Email</span>
                <a href={`mailto:${RECIPIENT}`} className={styles.infoValue}>
                  {RECIPIENT}
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
