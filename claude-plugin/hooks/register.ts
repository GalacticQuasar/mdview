import type { Register, SessionMessage } from 'claude-code'

// Claude Code's placeholder for a turn that got no answer, not a real response.
const PLACEHOLDER = 'No response requested.'

// The newest assistant message with text: the final message of the last turn,
// without the progress notes Claude writes between tool calls.
export const lastResponse = (messages: readonly SessionMessage[]): string =>
  messages.findLast((m) => m.role === 'assistant' && m.text.trim() && m.text.trim() !== PLACEHOLDER)
    ?.text.trim() ?? ''

// mdview reads the text from stdin and outlives this call. dash points a background
// job's stdin at /dev/null before applying `<&0`, so the pipe is saved on fd 3 first.
const LAUNCH = 'exec 3<&0; nohup node "$@" - <&3 3<&- >/dev/null 2>&1 &'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mdview', description: "Open Claude's last response in mdview" })
    return next(e)
  })

  on('command.run', { command: 'mdview' }, async $ => {
    const messages = await $.session.messages({ last: 200 })
    const text = 'deny' in messages ? '' : lastResponse(messages)
    if (!text) return { text: 'No response to show yet.', isTextDisplayOnly: true }
    const mdview = `${$.plugin.root}/../mdview.mjs`
    const args = String(options.args ?? '').split(/\s+/).filter(Boolean)
    const { exitCode, stderr } = await $.process.run(['sh', '-c', LAUNCH, 'sh', mdview, ...args], { stdin: text })
    if (exitCode !== 0) return { text: `mdview failed to start: ${stderr.trim()}`, isTextDisplayOnly: true }
    return { text: 'Opened in mdview.', isTextDisplayOnly: true }
  })
}
