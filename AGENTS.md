# LG Stream — working rules

- Speak to the owner in concise Arabic. Priorities: responsive channel navigation, stable playback, then picture/audio fidelity; visual resemblance to TiviMate is not a requirement.
- Independent webOS application for LG OLED55CS6LA (2022). Do not use TiviMate code, branding, or accounts.
- Read `docs/PROJECT_PROMPT_AR.md`, `docs/DEVICE_CAPABILITIES.md`, and `docs/HANDOFF.md` before continuing.
- Stage 0 is a small native-video playback probe. Do not build a full IPTV catalogue before validating playback on the real television.
- A single active media element and source. No speculative second-channel playback/prebuffer, unlimited retries, transcoding, DRM bypass, or server media proxy.
- Keep the television playback path independent of the development server. Default to plain HTML/CSS/JavaScript and platform playback; add dependencies only for an observed requirement.
- Never put stream URLs, playlists, account credentials, TV SSH keys/passphrases, or private network information in git, logs, screenshots, review prompts, or bug reports. Enter streams locally; memory-only storage by default. Do not request passwords or tokens in chat.
- Native playback acceptance is separate from desktop checks. Do not claim first visible frame, Dolby Vision, Atmos, stability, or superiority over TiviMate from mocks, filenames, metadata, `canPlayType`, or a `playing` event.
- Real-TV testing budget: one short baseline session, then one conditional Dolby sample. Repeat only to verify a material fix. Use small meaningful automated checks for cancellation, state handling, and data leakage; no broad browser matrix or soak test without a new need.
- Target documented webOS 22 capabilities conservatively; record actual firmware before device acceptance. DD+/EAC3 Atmos is a conditional target, not a promise. TrueHD Atmos and DTS are outside initial support.
- Developer Mode requires renewal. A successful IPK build or install is not proof that the television played media.
- Work only in this project. The shared server's other services/projects, firewall, domains, and authentication are outside scope. Do not expose a public endpoint.
- Keep changes reviewable and record exactly which checks passed and what still requires the user's television.
- Keep only the latest two successful LG Stream build outputs on the server. Never apply this cleanup to Git history, another project, or the owner's Windows laptop.
