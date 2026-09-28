/**
 * Content for the four legal pages.
 *
 * Kept as data rather than four hand-written JSX pages so the shell, the
 * table of contents, and the "last updated" treatment cannot drift apart, and
 * so a copy edit lands in one place.
 *
 * IMPORTANT — read before editing:
 *
 * These documents are a **starting-point template shipped with the source**,
 * not legal advice, and they are not a substitute for review by a qualified
 * lawyer. They describe this repository's default behaviour. Almost every
 * deployment of an open-source project differs in at least one material way:
 * who operates it, which LLM providers are configured, whether TLS terminates
 * in front of it, what is logged, and how long anything is retained.
 *
 * Whoever deploys this software is the party that actually collects and
 * processes data, and is therefore the party that must adapt these documents
 * (and the processing it describes) to their own situation before going live.
 * Each page carries that caveat in its own body, not only in this comment,
 * so a reader who lands on the published page sees it too.
 */

export interface LegalSection {
  /** Stable anchor id — also used by the table of contents. */
  id: string;
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  /**
   * Rendered as a callout directly under the heading rather than inline.
   * Used for the "this is a template" and "replace this" notes so they cannot
   * be skimmed past as ordinary body copy.
   */
  note?: string;
}

export interface LegalDocument {
  /** Route segment, e.g. "privacy" for /privacy. */
  slug: string;
  /** Label used in the in-page navigation. */
  navLabel: string;
  title: string;
  /** One or two sentences shown under the title. */
  summary: string;
  /** ISO date, rendered as-is so the string is exactly what was reviewed. */
  lastUpdated: string;
  sections: LegalSection[];
}

/** Shown on every legal page. Kept here so the four pages cannot disagree. */
export const LEGAL_DISCLAIMER =
  "This document is a template shipped with the source code of an open-source " +
  "project. It is not legal advice, and it has not been reviewed by a " +
  "qualified lawyer. The operator of any deployment is responsible for " +
  "adapting it to their actual practices before relying on it.";

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    slug: "privacy",
    navLabel: "Privacy Policy",
    title: "Privacy Policy",
    summary:
      "What this platform stores, why it stores it, and which parts of that are yours to change before you deploy.",
    lastUpdated: "2026-09-26",
    sections: [
      {
        id: "who-controls-your-data",
        heading: "Who controls your data",
        paragraphs: [
          "This platform is self-hosted open-source software. The project publishes source code; it does not operate a hosted service on your behalf. If you are reading this on a deployment, the operator of that deployment — the person or organisation that started the containers — is the controller of the personal data processed by it.",
          "In a typical deployment the operator holds the user accounts, the challenges and submissions people create, and any logs the deployment is configured to keep. Contact details for that operator should be published alongside the deployment; if they are not, that is a gap to fix before inviting users.",
        ],
        note:
          "Replace this section with the identity and contact details of the organisation actually running the deployment.",
      },
      {
        id: "what-is-collected",
        heading: "What is collected",
        paragraphs: [
          "The software stores only what it needs to run an evaluation. The categories below are the ones the default configuration creates.",
        ],
        bullets: [
          "Account data: the email address, the username you choose at registration, and the password hash — plus your role, your account status, and the times the account record was created and last updated. Passwords are hashed; the platform does not store them in a recoverable form.",
          "Sign-in identity, if you use GitHub: your GitHub account identifier, the name of the provider, and your GitHub avatar URL. These are stored only when you sign in through GitHub rather than with a password.",
          "Content you create: challenge prompts, the test suites attached to them, and the code that a model generated in response. Note that challenges are readable by anyone who can reach the deployment — see the Security page.",
          "Evaluation results: per-attempt scores, pass/fail counts, execution logs, timing and token metrics, and the repair history recorded for a failed attempt.",
          "Technical records: the authentication token's identifier and expiry. The rate limiter derives your IP address from the connection — or, behind a proxy the operator has marked as trusted, from the forwarding header — and uses it as part of a short-lived counter key in the cache. It is not written to the application database, and the counter expires within the rate-limit window. Beyond that, IP addresses appear only if the deployment is configured to keep request logs.",
        ],
      },
      {
        id: "what-is-sent-to-llm-providers",
        heading: "What is sent to LLM providers",
        paragraphs: [
          "Generating a solution means sending the challenge prompt to the provider you selected. When you pick a hosted provider — OpenAI, Anthropic or Gemini — that provider receives the prompt and its own copy of the policy and terms applies to the data it holds.",
          "Two things follow from this that a deployment should be explicit about. First, challenge prompts are disclosed to a third party, so prompts should not contain secrets. Second, a configured provider's retention settings govern the third-party copy, not this platform — an operator who cannot accept that should use the built-in demo provider or a local Ollama server, both of which generate code on your own machine and send nothing off it.",
        ],
        note:
          "If your deployment restricts which providers may be used, say so here and describe that restriction.",
      },
      {
        id: "generated-code-and-third-parties",
        heading: "Generated code and other third parties",
        paragraphs: [
          "Generated code is executed in an isolated, resource-limited container when the platform can reach a container runtime. That is a containment control, not a privacy control: the code still runs, and a determined escape from a container should be assumed possible rather than ruled out. Do not submit secrets in a challenge prompt, a test suite, or a generated solution.",
          "When no container runtime is available the platform falls back to running the test suite as an ordinary process on the host, with none of those limits. Know which path your deployment is on before inviting anyone to submit code — the Security page describes the difference.",
          "Third-party components are consumed as they are published. The Python, Node, TypeScript, Java and Go runners are invoked from the images the deployment provides; the Go toolchain is configured with module downloads disabled at runtime, so a test suite cannot pull arbitrary code from the network during an evaluation.",
        ],
      },
      {
        id: "retention",
        heading: "Retention",
        paragraphs: [
          "Retention is a deployment decision rather than a hard-coded one, because the reasonable period depends entirely on why someone is running this. The default guidance is as follows.",
        ],
        bullets: [
          "Account data: for as long as the account is active, and until deletion is requested.",
          "Challenges, submissions, and evaluation results: for as long as the owning account is active. Deleting an account does remove them — the records are linked by a cascading foreign key, so an operator deleting an account takes its challenges, submissions and results with it.",
          "Execution logs: kept only as long as they are useful for the evaluation they belong to. They are the most likely category to contain incidental detail and the first to expire.",
          "Backups: whatever window the operator's backup policy sets. Backups are not deleted immediately on account deletion and may persist until they age out.",
        ],
      },
      {
        id: "your-rights",
        heading: "Your rights",
        paragraphs: [
          "Depending on where you are, you may have rights to access the personal data held about you, to correct it, to have it erased, to restrict or object to its processing, to receive it in a portable form, and to complain to a supervisory authority.",
          "Because this is self-hosted software, the fastest route to exercising any of these is the deployment operator. Send the request to whoever operates the instance; there is no central registry behind these pages that can action it for you.",
        ],
        bullets: [
          "Access and portability: the platform can show you your own challenges, submissions, and results at any time.",
          "Erasure: there is no self-service account deletion. An operator can permanently delete an account through the admin interface, and that removes the account's content with it — but a user cannot delete their own account, so this one is a request to the operator.",
          "Rectification: there is no self-service way to change your email address or username. Your profile page shows them and lets you change your password; a corrected email or username has to be requested from the operator.",
          "Complaints: you may also complain directly to your data protection supervisory authority.",
        ],
      },
      {
        id: "cookies",
        heading: "Cookies and local storage",
        paragraphs: [
          "The platform sets no cookies at all, and embeds no advertising or analytics trackers. To keep you signed in it stores your authentication token — a signed JWT, valid for 24 hours by default — in your browser's local storage, alongside your theme and interface preferences. None of this is used to build a profile of you across sites.",
          "Because that token lives in local storage rather than an httpOnly cookie, any script running on this origin can read it. That is a deliberate trade-off for a single-page application, and it is the reason the platform avoids third-party scripts: adding one would put the token in reach. Operators who would rather not accept that should terminate the deployment behind a gateway that sets an httpOnly session cookie instead.",
        ],
      },
      {
        id: "children",
        heading: "Children",
        paragraphs: [
          "The platform is a developer tool and is not directed at children. An operator making it available to anyone under the age of 13, or the applicable local threshold, is responsible for that decision and for the lawful basis behind it.",
        ],
      },
      {
        id: "changes",
        heading: "Changes to this policy",
        paragraphs: [
          "The text on this page changes with the software, and the revision date at the top of the page records the last time it was reviewed. A deployment that changes how it handles personal data should update this page to match — shipping accurate text is the operator's responsibility, not the project's.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        paragraphs: [
          "Questions about this policy should go to the operator of the deployment, or — for a question about the software itself — to the project's issue tracker.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    navLabel: "Terms of Service",
    title: "Terms of Service",
    summary:
      "The ground rules for using a deployment, and the limits of what this open-source prototype promises.",
    lastUpdated: "2026-09-26",
    sections: [
      {
        id: "about-these-terms",
        heading: "About these terms",
        paragraphs: [
          "These terms govern access to a deployment of this open-source platform. By creating an account or using the software you accept them.",
          "The software is provided under the licence in the repository. These terms are separate from that licence: the licence covers the source code, while these terms cover your use of a running instance of it. Where they conflict, the licence governs the code itself.",
        ],
        note:
          "These terms are a template. Have a lawyer adapt them to your deployment, your jurisdiction, and any commercial context before you rely on them.",
      },
      {
        id: "the-service",
        heading: "The service",
        paragraphs: [
          "The platform accepts coding challenges, sends them to the model provider you select, executes the generated code in a sandboxed container, runs your test suite against it, and reports a score. The score reflects your tests: a high score means the code satisfied the tests you wrote, and nothing more.",
        ],
      },
      {
        id: "prototype-status",
        heading: "Prototype status — important",
        paragraphs: [
          "This is an open-source prototype, and it should be treated as one. It is offered without warranties of any kind, to the fullest extent the law allows, and you use it at your own risk.",
        ],
        bullets: [
          "It is not designed or tested as a production service, and no service level, uptime commitment, or availability guarantee is offered.",
          "Where you select a hosted provider — OpenAI, Anthropic or Gemini — each evaluation consumes that provider's API credits, and those costs are yours. The platform ships no budget, spend cap, or quota of its own to stop them. The default provider is the built-in demo provider, which generates code locally and costs nothing, and a local Ollama server is also supported without a key.",
          "Features may change or be removed without notice as the project develops.",
          "Scores are only as meaningful as the test suites behind them. A solution that passes your tests has not thereby been proven correct.",
        ],
      },
      {
        id: "acceptable-use",
        heading: "Acceptable use",
        paragraphs: [
          "You agree not to use the deployment to do anything unlawful, and in particular not to:",
        ],
        bullets: [
          "Submit prompts, tests, or code that infringes intellectual property rights, or that you lack the right to submit.",
          "Use the deployment to generate malware, or to attack systems you are not authorised to test.",
          "Attempt to escape or subvert the sandbox, or to exceed the resource limits applied to a container.",
          "Probe, scan, or load-test a deployment you do not operate without written permission from its operator.",
          "Upload secrets, credentials, or personal data belonging to other people. Isolation reduces risk; it does not make submission of secrets safe.",
        ],
      },
      {
        id: "your-content",
        heading: "Your content",
        paragraphs: [
          "You keep ownership of the challenges, tests, and submissions you create. You grant the operator the limited permission needed to host, process, and display that content in order to operate the service — for example, to run your test suite and show you a report.",
          "Generated code is produced by a third-party model in response to your prompt. You are responsible for reviewing it before relying on it, and for compliance with the licence terms of whichever provider you configure.",
        ],
      },
      {
        id: "suspension",
        heading: "Suspension and termination",
        paragraphs: [
          "The operator of a deployment may suspend or terminate access to anyone who breaches these terms or the acceptable-use rules above, and may remove content that violates them. You may stop using the service and request deletion of your account at any time.",
        ],
      },
      {
        id: "liability",
        heading: "Disclaimer and liability",
        paragraphs: [
          "The software is provided as-is and without warranties of any kind, whether express or implied, including any implied warranty of merchantability, fitness for a particular purpose, or non-infringement. To the fullest extent permitted by law, no operator or contributor is liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, profits, or goodwill, arising out of your use of the deployment.",
        ],
        note:
          "Liability language is jurisdiction-specific. A consumer in some jurisdictions cannot have liability for personal injury waived, and this clause should be reviewed rather than copied.",
      },
      {
        id: "changes",
        heading: "Changes to these terms",
        paragraphs: [
          "The operator may update these terms. The revision date at the top of the page records the last review, and continued use after a change means you accept the updated terms.",
        ],
      },
    ],
  },
  {
    slug: "security",
    navLabel: "Security",
    title: "Security",
    summary:
      "How the platform isolates generated code, what protects it, and — just as important — what does not.",
    lastUpdated: "2026-09-26",
    sections: [
      {
        id: "security-model",
        heading: "Security model in one paragraph",
        paragraphs: [
          "The central risk in a platform like this is that it runs code a model wrote, on purpose, on a machine you care about. The design response is containment: every generated solution executes inside its own short-lived, resource-limited container with no network access, while the platform itself never executes generated code in its own process.",
        ],
      },
      {
        id: "sandboxing",
        heading: "Sandboxing and containment",
        paragraphs: [
          "Each evaluation runs in a disposable container with CPU, memory, and wall-clock limits applied, and the container is discarded when the run ends. Thirteen languages are supported: Python, JavaScript, TypeScript, Java and Go each have a dedicated test runner — pytest, node --test, the tsx test runner, the JUnit Platform console launcher and go test — and C, C++, Rust, PHP, Ruby, Perl, Kotlin and Lua share a compile-and-run harness.",
        ],
        bullets: [
          "The container has no network access during evaluation. Module and package downloads are disabled at runtime, so a test suite cannot pull and execute remote code mid-run.",
          "Egress restrictions mean generated code cannot exfiltrate data during execution.",
          "Resource limits bound a runaway loop, a memory bomb, or an infinite recursion to a failure rather than to a dead host.",
          "The container runs as an unprivileged user with a read-only filesystem, all capabilities dropped, a cap on process count, and no privilege escalation.",
          "Containers are discarded after the run, so nothing persists between evaluations beyond the recorded result.",
        ],
      },
      {
        id: "authentication",
        heading: "Authentication and authorisation",
        paragraphs: [
          "Authentication uses stateless JWTs with a configurable expiry. Passwords are stored hashed, and role checks are enforced server-side on the admin routes rather than in the client.",
        ],
        bullets: [
          "Administrative routes are gated on the account's admin flag in the database, verified by the API on every request.",
          "Submissions and their results are owner-scoped: asking for someone else's submission returns not-found rather than its contents.",
          "Challenges are not private. The challenge list and any individual challenge can be read by anyone who can reach the deployment, including the prompt and the test suite. Only modifying or deleting a challenge is restricted to its owner.",
          "A shared evaluation report is readable by anyone holding its link. That is what makes the feature work, and it is why such a link should be treated as public.",
        ],
      },
      {
        id: "rate-limiting",
        heading: "Rate limiting",
        paragraphs: [
          "Every API route is rate limited by a fixed-window counter kept in Redis. The default budget is 60 requests a minute for an anonymous caller, identified by IP address, and 120 a minute for a signed-in account, measured over a 60-second window. Login and registration are covered, because the limiter is applied to the API as a whole rather than per route.",
          "It is a rate cap, not an authentication control. Knowing the limits matters when reading the list of known weaknesses below.",
        ],
        bullets: [
          "It fails open: if the cache is unreachable the limiter logs the failure and allows the request rather than blocking it. A deployment that depends on it for abuse resistance should alert on that condition.",
          "It is keyed on IP address for anonymous callers, so users behind one NAT or proxy share a budget, and a determined caller with many addresses gets many budgets.",
          "WebSocket connections are exempt, because a long-lived connection is not a series of requests to count.",
        ],
      },
      {
        id: "limits",
        heading: "Known limits of this design",
        paragraphs: [
          "A security page that only lists strengths is not useful. The following are real limits of the current design and should be read as part of the model, not as an aside.",
        ],
        bullets: [
          "Containment depends on the container path being available. If the container runtime is disabled or unreachable, the platform falls back to running the test suite as an ordinary process on the host, with no network isolation, no memory or CPU cap, no read-only filesystem and no dropped capabilities. Every containment control described above applies to the container path only. A deployment intending to run untrusted code should confirm which path it is on, and ideally fail closed rather than fall back.",
          "Each of those controls is a setting, so an operator can turn the air gap or the read-only filesystem off. The defaults are safe; the configuration is not enforced.",
          "Container isolation is a strong boundary, not an absolute one. Assume a determined escape is possible and do not treat the sandbox as a substitute for running untrusted code on separate infrastructure.",
          "A submission runs with the privileges of the container, so the host's Docker socket exposure matters. A deployment should not grant the sandbox more host access than it needs.",
          "The authentication token is kept in browser local storage, so any script able to run on the origin can read it. This is why the platform loads no third-party scripts; adding one would widen that exposure.",
          "LLM API keys live in the server environment. Anyone with access to the host or the process environment can read them.",
          "The rate limiter caps request volume but provides no account lockout, no failed-login counter, and no challenge on repeated attempts. A deployment exposed to the public internet should put real brute-force protection at the edge.",
          "There is no multi-factor authentication and no way for a user to change their own email address or delete their own account; both are operator-handled.",
          "Shared-result links are intentionally readable by anyone holding the link. Treat such a link as public and do not share evaluations containing sensitive prompts.",
        ],
      },
      {
        id: "responsible-disclosure",
        heading: "Reporting a vulnerability",
        paragraphs: [
          "Found something exploitable? Contact the maintainers directly rather than opening a public issue, and give them a reasonable window to ship a fix before disclosing details. The repository is private and does not currently publish a security policy or a private advisory channel, so use whatever direct route you already have to the maintainers.",
          "Until that changes, treat a public issue as a last resort: an issue is visible to everyone the moment it is filed, including to whoever is exploiting the problem. A report that includes the affected version, reproduction steps, and an assessment of impact is far more useful than one without them.",
        ],
      },
    ],
  },
  {
    slug: "gdpr",
    navLabel: "GDPR",
    title: "GDPR & Data Protection",
    summary:
      "A summary of the processing this platform performs, and the rights a data subject has over it.",
    lastUpdated: "2026-09-26",
    sections: [
      {
        id: "scope",
        heading: "Scope and role",
        paragraphs: [
          "This page summarises the processing the software is capable of performing. It sits alongside the Privacy Policy and does not replace it; where the two differ, the Privacy Policy governs.",
          "Because this is self-hosted software, the operator of a deployment is normally the controller for personal data processed by it. The project publishes the code and does not process personal data on an operator's behalf. Obligations that fall on a controller — a lawful basis, a data-processing agreement with each provider, a records of processing, and a route for data-subject requests — are the operator's to discharge.",
        ],
        note:
          "This is a summary for transparency, not a compliance statement. A deployment that serves EU/EEA data subjects needs its own assessment.",
      },
      {
        id: "lawful-basis",
        heading: "Lawful basis for processing",
        paragraphs: [
          "The processing the default configuration performs falls into a small number of categories, each of which needs a basis selected deliberately by the operator rather than inherited from this page.",
        ],
        bullets: [
          "Account administration and authentication — necessary to provide the service to the person requesting it.",
          "Executing an evaluation, including sending the challenge prompt to the configured LLM provider — necessary to deliver the service the person asked for.",
          "Retaining results so a user can review past evaluations — necessary for the service as described.",
          "Security logging, where a deployment keeps it — legitimate interests in defending the deployment and its users.",
          "Any marketing or analytics use of the data — not performed by the software by default, and would need its own basis if an operator added it.",
        ],
      },
      {
        id: "categories-and-recipients",
        heading: "Categories of data and recipients",
        paragraphs: [
          "Personal data processed: account identifiers, the content of challenges and test suites, generated code, and evaluation results. Recipients: the configured LLM provider, which receives the challenge prompt as part of generation, and — in a deployment that configures it — infrastructure providers such as the host, the database, and the cache.",
          "Because the prompt is disclosed to a provider, do not include personal data in a challenge prompt unless the operator has a basis and a data-processing agreement that permits it.",
        ],
      },
      {
        id: "transfers",
        heading: "International transfers",
        paragraphs: [
          "An LLM provider may process a prompt outside the European Economic Area. Where that happens, the operator is responsible for putting an appropriate transfer mechanism in place and for being able to say which one applies to which provider. The software cannot make that determination on the operator's behalf.",
        ],
      },
      {
        id: "retention-and-deletion",
        heading: "Retention and erasure",
        paragraphs: [
          "Storage limitation is an obligation the operator has to meet, and the software is built to make it achievable: content is scoped to an owning account and linked to it by a cascading foreign key, so an operator who deletes an account removes that account's challenges, submissions, and results together. There is no self-service deletion for a user to perform, which means an erasure request has to be carried out by a person.",
          "Two categories need deliberate attention. Execution logs are the most likely to contain incidental detail and should expire soonest. Backups are outside the application's control and persist until they age out of the backup window, which must be disclosed rather than glossed over.",
        ],
      },
      {
        id: "data-subject-rights",
        heading: "Data subject rights",
        paragraphs: [
          "Where the GDPR applies, a data subject may exercise rights of access, rectification, erasure, restriction, objection, portability, and complaint to a supervisory authority.",
          "The platform lets a user review their own content and change their password, which covers access and portability without operator involvement. It offers no self-service change to the email address or username, so rectification is only partly self-service, and there is no self-service account deletion, so erasure always needs the operator to act. Restriction and objection likewise have to be handled by the operator, through a contact point that the deployment should publish.",
        ],
      },
      {
        id: "automated-decision-making",
        heading: "Automated decision-making",
        paragraphs: [
          "An evaluation score is produced automatically, but it is not a decision producing legal or similarly significant effects for a data subject: it is a measurement against test suites the user supplied. Scores should not be used to make employment, credit, insurance, or similar decisions about a person. The generated code is the artefact under test, not a judgement about anyone.",
        ],
      },
    ],
  },
];

/** Looks up a document by route segment. Throws on an unknown slug so a typo
 *  in a route definition fails loudly at import time rather than rendering an
 *  empty page in production. */
export function getLegalDocument(slug: string): LegalDocument {
  const doc = LEGAL_DOCUMENTS.find((candidate) => candidate.slug === slug);
  if (!doc) {
    throw new Error(`Unknown legal document: ${slug}`);
  }
  return doc;
}
