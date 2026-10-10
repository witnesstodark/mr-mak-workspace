import { useEffect, useRef, useState } from 'react'

interface Image { url?: string; name: string; unavailable?: boolean }
function SharedImage({ image, onOpen }: { image: Image; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)
  if (!image.url || image.unavailable || failed) return <p className="mobile-image-unavailable">Image unavailable on this computer.</p>
  return <figure className="mobile-conversation-image"><button type="button" aria-label={`Enlarge ${image.name}`} onClick={onOpen}><img src={image.url} alt={image.name} loading="lazy" onError={() => setFailed(true)} /></button><figcaption>{image.name}<a href={`${image.url}?download=1`} download>Download</a></figcaption></figure>
}
export default function ConversationImages({ images }: { images?: Image[] }) {
  const [selected, setSelected] = useState<Image | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (selected && node && !node.open) node.showModal()
    else if (!selected && node?.open) node.close()
  }, [selected])
  if (!images?.length) return null
  return <div className="mobile-conversation-images">{images.map((image, index) => <SharedImage key={image.url || index} image={image} onOpen={() => setSelected(image)} />)}<dialog ref={dialog} className="mobile-image-dialog" aria-label="Shared image preview" onClose={() => setSelected(null)} onCancel={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) setSelected(null) }}><header><span>{selected?.name}</span><button type="button" onClick={() => setSelected(null)}>Close</button></header>{selected?.url && <><img src={selected.url} alt={selected.name} /><a href={`${selected.url}?download=1`} download>Download image</a></>}</dialog></div>
}
