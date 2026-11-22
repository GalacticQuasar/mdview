import type { Register, SessionMessage } from 'claude-code'

// Claude Code's placeholder for a turn that got no answer, not a real response.
const PLACEHOLDER = 'No response requested.'

// The newest assistant message with text: the final message of the last turn,
// without the progress notes Claude writes between tool calls.
export const lastResponse = (messages: readonly SessionMessage[]): string =>
  messages.findLast((m) => m.role === 'assistant' && !['', PLACEHOLDER].includes(m.text.trim()))?.text.trim() ?? ''

// mdview reads the text from stdin and outlives this call. dash points a background
// job's stdin at /dev/null before applying `<&0`, so the pipe is saved on fd 3 first.
// Once detached, mdview's errors go nowhere, so a missing command is caught before that.
const LAUNCH = 'command -v mdview >/dev/null || exit 127; exec 3<&0; nohup mdview "$@" - <&3 3<&- >/dev/null 2>&1 &'
const INSTALL = 'npm install -g @galacticquasar/mdview'

// Output for the person only, kept out of what Claude reads.
const say = (text: string) => ({ text, isTextDisplayOnly: true as const })

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mdview', description: "Open Claude's last response in mdview" })
    return next(e)
  })

  on('command.run', { command: 'mdview' }, async $ => {
    const messages = await $.session.messages({ last: 200 })
    const text = 'deny' in messages ? '' : lastResponse(messages)
    if (!text) return say('No response to show yet.')
    const args = String(options.args ?? '').split(/\s+/).filter(Boolean)
    const { exitCode } = await $.process.run(['sh', '-c', LAUNCH, 'sh', ...args], { stdin: text })
    if (exitCode === 127) return say(`The mdview command isn't on PATH. Install it with: ${INSTALL}`)
    return say('Opened in mdview.')
  })
}
