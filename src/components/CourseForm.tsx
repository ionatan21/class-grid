import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Course, CourseColor, TimeRange, Schedule } from '../domain'
import type { Day } from '../domain'
import './CourseForm.css'

const DAYS: Day[] = ['L', 'K', 'M', 'J', 'V', 'S', 'D']

const START_HOURS = Array.from({ length: 16 }, (_, i) => {
  const h = i + 7
  return `${String(h).padStart(2, '0')}:00`
})

const END_HOURS = Array.from({ length: 16 }, (_, i) => {
  const h = i + 7
  return `${String(h).padStart(2, '0')}:50`
})

const PRESET_COLORS = CourseColor.PRESETS

const EMPTY_FORM = {
  name: '',
  days: [] as Day[],
  startTime: '',
  endTime: '',
  color: PRESET_COLORS[0],
}

export interface CourseFormDraft {
  ids: string[]
  name: string
  days: Day[]
  startTime: string
  endTime: string
  color: string
}

function formFromDraft(draft: CourseFormDraft | null) {
  if (!draft) return EMPTY_FORM
  return {
    name: draft.name,
    days: draft.days,
    startTime: draft.startTime,
    endTime: draft.endTime,
    color: draft.color,
  }
}

interface Props {
  schedule: Schedule
  onAdd: (course: Course) => void
  onUpdate: (courseIds: string[], course: Course) => void
  editingDraft: CourseFormDraft | null
  onCancelEdit: () => void
  isSharedView?: boolean
}

export default function CourseForm({
  schedule,
  onAdd,
  onUpdate,
  editingDraft,
  onCancelEdit,
  isSharedView = false,
}: Props) {
  const { t } = useTranslation()
  const [form, setForm] = useState(() => formFromDraft(editingDraft))
  const [touched, setTouched] = useState(false)

  /* ── validations ─────────────────────────────────────── */
  const timeError = useMemo(() => {
    if (!form.startTime || !form.endTime) return null
    return form.endTime <= form.startTime
      ? t('courseForm.timeError')
      : null
  }, [form.startTime, form.endTime, t])

  const availableEndHours = useMemo(() => {
    if (!form.startTime) return END_HOURS
    const startHour = parseInt(form.startTime.split(':')[0], 10)
    return END_HOURS.filter((t) => parseInt(t.split(':')[0], 10) >= startHour)
  }, [form.startTime])

  const conflictWarning = useMemo(() => {
    if (!form.startTime || !form.endTime || timeError || form.days.length === 0) return null
    try {
      const range = new TimeRange(form.startTime, form.endTime)
      const candidate = new Course(form.name || '…', form.days, range, new CourseColor(form.color))
      const check = schedule.checkConflict(candidate)
      return check.hasConflict ? t('courseForm.conflict', { name: check.existing.name, day: check.day }) : null
    } catch {
      return null
    }
  }, [schedule, form.startTime, form.endTime, form.days, form.color, form.name, timeError, t])

  const isValid =
    form.name.trim() !== '' &&
    form.days.length > 0 &&
    form.startTime !== '' &&
    form.endTime !== '' &&
    !timeError &&
    !conflictWarning

  /* ── handlers ────────────────────────────────────────── */
  function toggleDay(day: Day) {
    setForm((f) => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day],
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!isValid) return
    try {
      const course = new Course(
        form.name.trim(),
        form.days,
        new TimeRange(form.startTime, form.endTime),
        new CourseColor(form.color),
        editingDraft?.ids[0],
      )
      if (editingDraft) {
        onUpdate(editingDraft.ids, course)
      } else {
        onAdd(course)
      }
      setForm(EMPTY_FORM)
      setTouched(false)
    } catch (err) {
      console.error('Error creating course:', err)
    }
  }

  /* ── render ──────────────────────────────────────────── */
  return (
    <form className="course-form" onSubmit={handleSubmit} noValidate>
      <h2 className="cf-title">
        {editingDraft ? t('courseForm.editTitle') : t('courseForm.title')}
      </h2>
      {isSharedView && (
        <p className="cf-readonly-notice">{t('courseForm.readOnlyNotice')}</p>
      )}
      <fieldset disabled={isSharedView} className="cf-fieldset">

      {/* Course name */}
      <div className="cf-field">
        <label htmlFor="course-name" className="cf-label">
          {t('courseForm.nameLabel')}
        </label>
        <input
          id="course-name"
          type="text"
          className={`cf-input ${touched && !form.name.trim() ? 'cf-input--error' : ''}`}
          placeholder={t('courseForm.namePlaceholder')}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        {touched && !form.name.trim() && (
          <span className="cf-error-msg">{t('courseForm.nameRequired')}</span>
        )}
      </div>

      {/* Days */}
      <div className="cf-field">
        <span className="cf-label">{t('courseForm.daysLabel')}</span>
        <div className="cf-days">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              className={`cf-day-btn ${form.days.includes(day) ? 'cf-day-btn--active' : ''}`}
              style={form.days.includes(day) ? { backgroundColor: form.color, borderColor: form.color } : undefined}
              onClick={() => toggleDay(day)}
            >
              {t(`dayAbbr.${day}`)}
            </button>
          ))}
        </div>
        {touched && form.days.length === 0 && (
          <span className="cf-error-msg">{t('courseForm.daysRequired')}</span>
        )}
      </div>

      {/* Time range */}
      <div className="cf-time-row">
        <div className="cf-field">
          <label htmlFor="start-time" className="cf-label">{t('courseForm.fromLabel')}</label>
          <select
            id="start-time"
            className={`cf-input cf-select ${touched && !form.startTime ? 'cf-input--error' : ''}`}
            value={form.startTime}
            onChange={(e) => {
              const newStart = e.target.value
              setForm((f) => ({
                ...f,
                startTime: newStart,
                endTime:
                  f.endTime && f.endTime.split(':')[0] < newStart.split(':')[0]
                    ? ''
                    : f.endTime,
              }))
            }}
          >
            <option value="">--</option>
            {START_HOURS.map((time) => (
              <option key={time} value={time}>{time}</option>
            ))}
          </select>
        </div>
        <div className="cf-field">
          <label htmlFor="end-time" className="cf-label">{t('courseForm.toLabel')}</label>
          <select
            id="end-time"
            className={`cf-input cf-select ${(touched && !form.endTime) || timeError ? 'cf-input--error' : ''}`}
            value={form.endTime}
            onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
          >
            <option value="">--</option>
            {availableEndHours.map((time) => (
              <option key={time} value={time}>{time}</option>
            ))}
          </select>
        </div>
      </div>
      {touched && !form.endTime && !timeError && (
        <span className="cf-error-msg">{t('courseForm.endTimeRequired')}</span>
      )}
      {timeError && <span className="cf-error-msg">{timeError}</span>}

      {/* Color picker */}
      <div className="cf-field">
        <span className="cf-label">{t('courseForm.colorLabel')}</span>
        <div className="cf-colors">
          {PRESET_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`cf-color-swatch ${form.color === hex ? 'cf-color-swatch--active' : ''}`}
              style={{ backgroundColor: hex }}
              aria-label={hex}
              onClick={() => setForm((f) => ({ ...f, color: hex }))}
            />
          ))}
          <label className="cf-color-custom" title={t('courseForm.colorCustomTitle')}>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
            />
            <span className="cf-color-custom__icon">+</span>
          </label>
        </div>
      </div>

      {/* Conflict warning */}
      {conflictWarning && (
        <div className="cf-warning">
          ⚠ {conflictWarning}
        </div>
      )}

      {/* Actions */}
      <div className="cf-actions">
        <button type="submit" className="cf-btn cf-btn--primary">
          {editingDraft ? t('courseForm.saveBtn') : t('courseForm.addBtn')}
        </button>
        {editingDraft && (
          <button
            type="button"
            className="cf-btn cf-btn--ghost"
            onClick={() => {
              setForm(EMPTY_FORM)
              setTouched(false)
              onCancelEdit()
            }}
          >
            {t('courseForm.cancelEdit')}
          </button>
        )}
      </div>

      {/* Footer */}
      <p className="cf-footer">
        {t('courseForm.footer')}{' '}
        <a
          href="https://portfolio-jonatan-barrios.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="cf-footer__link"
        >
          {t('courseForm.footerAuthor')}
        </a>
      </p>
      </fieldset>
    </form>
  )
}
