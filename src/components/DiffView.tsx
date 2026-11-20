// A unified diff, one line per row, coloured by what the line does.
export default function DiffView({ text }: { text: string }) {
  const lines = text.split('\n')
  return <div className="diff-view" role="table" aria-label="Diff">{lines.map((line, index) => {
    const kind = /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line) ? 'meta' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : ''
    return <div role="row" key={index} className={`diff-line ${kind}`}>{line || ' '}</div>
  })}</div>
}
