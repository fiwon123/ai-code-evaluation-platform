# AI Eval Platform - Dev Sandbox Shell Configuration
# Sets a [SANDBOX] badge in the prompt and the terminal title so it's always
# obvious when you're inside the dev container. Supports bash and zsh.
#
# Sourced from:
#   - /etc/profile.d/00-dev-sandbox.sh  (bash login shells)
#   - ~/.bashrc                          (bash interactive non-login shells)
#   - ~/.zshrc                           (zsh interactive shells)
#   - ~/.zprofile                        (zsh login shells, e.g. make opencode)

# Skip if not in a container
[ -f /.dockerenv ] || return 0

if [ -n "$ZSH_VERSION" ]; then
  # --- zsh ---
  # Terminal title with SANDBOX and current directory
  __sandbox_set_title() {
    printf '\033]0;[SANDBOX] ai-code-evaluation-platform — %s\007' "${PWD:t}"
  }

  if [[ $- == *i* ]]; then
    # Interactive: colored prompt with [SANDBOX] badge + title on each prompt
    autoload -U colors && colors
    PROMPT='%F{red}[SANDBOX]%f %F{green}%n@%m%f %F{blue}%~%f $ '
    # Idempotent registration (rc is sourced from both ~/.zprofile and ~/.zshrc
    # for login+interactive shells).
    (( ${precmd_functions[(Ie)__sandbox_set_title]} )) || precmd_functions+=(__sandbox_set_title)
  else
    # Login non-interactive (zsh -lc, e.g. make opencode): set the title once
    __sandbox_set_title
  fi
  return
fi

# --- bash ---
# Terminal title with SANDBOX and current directory
__sandbox_set_title() {
  printf '\033]0;[SANDBOX] ai-code-evaluation-platform — %s\007' "${PWD##*/}"
}

if [[ $- == *i* ]]; then
  # Interactive: colored prompt with [SANDBOX] badge + title on each prompt
  export PS1='\[\e[1;31m\][SANDBOX]\[\e[0m\] \[\e[32m\]\u@\h\[\e[0m\]:\[\e[34m\]\w\[\e[0m\]\$ '
  PROMPT_COMMAND="__sandbox_set_title${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
else
  # Login non-interactive (bash -lc, e.g. make opencode): set the title once
  __sandbox_set_title
fi