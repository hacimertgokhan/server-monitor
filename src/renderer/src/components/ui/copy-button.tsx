import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'

/** Copies `text` to the clipboard and confirms with a check mark. */
export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      title={t('Copy')}
      aria-label={label ?? t('Copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? <Check className="text-ok" /> : <Copy />}
      {label}
    </Button>
  )
}
