import './backgroundWork.css'

export interface WorkingAgent { id: string; name: string; type: string; step: string; startedAt: string; updatedAt: string }
export interface BackgroundCommand { id: string; name: string; title: string; startedAt: string; agent?: string }

function elapsed(from: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(from)) / 1000))
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`
}
const count = (value: number, noun: string) => value === 1 ? `1 ${noun}` : `${value} ${noun}s`

// Subagents and background commands the chat started that are still working. Shown
// above the composer, since they keep going while the chat itself is idle.
export default function BackgroundWork({ agents = [], commands = [], now }: { agents?: WorkingAgent[]; commands?: BackgroundCommand[]; now: number }) {
  if (!agents.length && !commands.length) return null
  const title = [agents.length && count(agents.length, 'agent'), commands.length && count(commands.length, 'command')].filter(Boolean).join(' and ')
  return <details className="background-work">
    <summary><i aria-hidden="true" /><strong>{title} working</strong><span>{[...agents.map(agent => agent.name), ...commands.map(command => command.title)].join(' · ')}</span></summary>
    <ul>
      {agents.map(agent => <li key={agent.id}>
        <strong>{agent.name}</strong>
        <span>{agent.step}</span>
        <small>{[agent.type, `running ${elapsed(agent.startedAt, now)}`].filter(Boolean).join(' · ')}</small>
      </li>)}
      {commands.map(command => <li key={command.id} className="command">
        <strong>{command.title}</strong>
        <span>{command.agent ? `${command.name} · started by ${command.agent}` : command.name}</span>
        <small>{`running ${elapsed(command.startedAt, now)}`}</small>
      </li>)}
    </ul>
  </details>
}
