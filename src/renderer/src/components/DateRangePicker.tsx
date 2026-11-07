import { useState } from 'react'
import type { DateRange } from '@shared/types'
import { PRESET_LABELS, presetRange, type RangePreset } from '../lib/dates'

interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  initialPreset?: RangePreset
}

export function DateRangePicker({ value, onChange, initialPreset = 'today' }: DateRangePickerProps) {
  const [preset, setPreset] = useState<RangePreset>(initialPreset)

  return (
    <div className="date-range">
      <select
        value={preset}
        onChange={(e) => {
          const p = e.target.value as RangePreset
          setPreset(p)
          if (p !== 'custom') onChange(presetRange(p))
        }}
        aria-label="Period"
      >
        {Object.entries(PRESET_LABELS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={value.from}
        max={value.to}
        onChange={(e) => {
          if (!e.target.value) return
          setPreset('custom')
          onChange({ ...value, from: e.target.value })
        }}
        aria-label="From"
      />
      <span className="muted">to</span>
      <input
        type="date"
        value={value.to}
        min={value.from}
        onChange={(e) => {
          if (!e.target.value) return
          setPreset('custom')
          onChange({ ...value, to: e.target.value })
        }}
        aria-label="To"
      />
    </div>
  )
}
