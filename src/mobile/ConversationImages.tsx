import { useState } from 'react'
import ImageViewer, { type ConversationImage } from './ImageViewer'

function SharedImage({ image, onOpen }: { image: ConversationImage; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)
  if (!image.url || image.unavailable || failed) return <p className="mobile-image-unavailable">Image unavailable on this computer.</p>
  return <figure className="mobile-conversation-image"><button type="button" aria-label={`Enlarge ${image.name}`} onClick={onOpen}><img src={image.url} alt={image.name} loading="lazy" onError={() => setFailed(true)} /></button><figcaption>{image.name}<a href={`${image.url}?download=1`} download>Download</a></figcaption></figure>
}
export default function ConversationImages({ images }: { images?: ConversationImage[] }) {
  const [selected, setSelected] = useState<ConversationImage | null>(null)
  if (!images?.length) return null
  return <div className="mobile-conversation-images">{images.map((image, index) => <SharedImage key={image.url || index} image={image} onOpen={() => setSelected(image)} />)}{selected && <ImageViewer image={selected} onClose={() => setSelected(null)} />}</div>
}
