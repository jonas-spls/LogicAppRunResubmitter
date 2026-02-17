import { useState, useRef, useEffect } from 'react'

interface Props {
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  disabled?: boolean
  placeholder?: string
}

export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  disabled = false,
  placeholder = 'All'
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const allSelected = selected.length === 0 || selected.length === options.length

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleOption = (option: string): void => {
    if (selected.includes(option)) {
      const next = selected.filter((s) => s !== option)
      onChange(next)
    } else {
      const next = [...selected, option]
      // If all options are now selected, treat as "All"
      onChange(next.length === options.length ? [] : next)
    }
  }

  const toggleAll = (): void => {
    // If all are selected (or empty = all), deselect all; otherwise select all
    onChange([])
  }

  const displayText = allSelected
    ? placeholder
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`

  return (
    <div className={`multi-select ${disabled ? 'disabled' : ''}`} ref={ref}>
      <button
        type="button"
        className="multi-select-trigger"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className="multi-select-text">{displayText}</span>
        <span className="multi-select-arrow">{open ? '\u25B4' : '\u25BE'}</span>
      </button>
      {open && (
        <div className="multi-select-dropdown">
          <label className="multi-select-option">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>All</span>
          </label>
          <div className="multi-select-divider" />
          {options.map((option) => (
            <label key={option} className="multi-select-option">
              <input
                type="checkbox"
                checked={allSelected || selected.includes(option)}
                onChange={() => toggleOption(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
