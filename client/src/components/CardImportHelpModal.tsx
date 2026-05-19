import { useState } from 'react'
import { Modal } from './Modal'

const SAMPLE_CSV = `word,pos,definition_l2,definition_l1,example_sentence
ameliorate,verb,to make something bad or unsatisfactory better,,"The new policy will ameliorate living conditions."
ephemeral,adj,lasting for only a short time,,"Fame can be ephemeral."
ubiquitous,adj,seeming to appear everywhere at the same time,,"Smartphones are now ubiquitous."
pragmatic,adj,dealing with things sensibly and realistically,,
`

const LLM_PROMPT = `I need to generate a CSV file (template file attached) for a word list. The word list is below, but I need you to add each word to its own row in the CSV, then for each word add in part of speech (pos), English definition (definition_l2), and a clear example sentence (example_sentence). You can leave the "definition_l1" field blank.

My word list:

ant
bug
crab
etc.`

interface Props {
  onClose: () => void
}

export function CardImportHelpModal({ onClose }: Props) {
  const [copied, setCopied] = useState(false)

  const handleDownload = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'vanilla-cards-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(LLM_PROMPT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Modal title="How do I add a word list?" onClose={onClose}>
      <div style={{ maxWidth: 560, overflowY: 'auto', maxHeight: '70vh' }}>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
          Add a set of cards (in Vanilla Class SRS this is called a CardSet) by uploading a CSV
          file with all of the word data. Download the sample CSV below to see what data goes in
          the CSV. Then create your word list and use your LLM of choice (ChatGPT, Gemini, Claude,
          Deepseek all work fine) to fill out all the fields in your CSV for your word list. You
          can use the prompt below. After you get your CSV you can still edit it as needed, then
          upload the CSV file here to import your words.
        </p>

        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-primary" onClick={handleDownload} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 12l-4-4h2.5V2h3v6H12L8 12z"/>
              <path d="M2 14h12v-2H2v2z"/>
            </svg>
            Download sample CSV
          </button>
        </div>

        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>LLM prompt</div>
        <div style={{ position: 'relative' }}>
          <pre style={{
            background: 'var(--color-pistachio, #f4f7f4)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '12px 40px 12px 12px',
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            color: 'var(--color-text)',
          }}>
            {LLM_PROMPT}
          </pre>
          <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy prompt'}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: copied ? 'var(--color-accent-alt, #2ecc71)' : 'var(--color-surface, #fff)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              padding: '3px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: copied ? '#fff' : 'var(--color-text-muted)',
              transition: 'all 0.15s',
            }}
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.5 2.5l-7 7-3-3-1.5 1.5 4.5 4.5 8.5-8.5z"/>
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 4h8v10H4V4zm1 1v8h6V5H5zM6 2h7v9h-1V3H6V2z"/>
                </svg>
                Copy
              </>
            )}
          </button>
        </div>

        <div style={{ marginTop: 20 }} className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  )
}
