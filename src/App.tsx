import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import logo from './assets/logo.svg'
import iconMoon from './assets/icon-moon.svg'
import iconSun from './assets/icon-sun.svg'
import CourseForm from './components/CourseForm'
import type { CourseFormDraft } from './components/CourseForm'
import ScheduleView from './components/ScheduleView'
import type { CourseMoveDraft } from './components/ScheduleView'
import { Schedule, Course, CourseColor, TimeRange } from './domain'
import type { Day } from './domain'
import { usePersistedCourses } from './hooks/usePersistedCourses'
import './App.css'

// ── Serialization helpers (mirrors usePersistedCourses format) ────────────────

interface SerializedCourse {
  id: string
  name: string
  days: Day[]
  start: string
  end: string
  color: string
}

function serializeCourses(courses: Course[]): SerializedCourse[] {
  return courses.map((c) => ({
    id: c.id,
    name: c.name,
    days: [...c.days],
    start: c.timeRange.start,
    end: c.timeRange.end,
    color: c.color.hex,
  }))
}

function deserializeCourses(data: SerializedCourse[]): Course[] {
  return data.map(
    (d) =>
      new Course(
        d.name,
        d.days,
        new TimeRange(d.start, d.end),
        new CourseColor(d.color),
        d.id,
      ),
  )
}

// ── Share state ───────────────────────────────────────────────────────────────

export type ShareStatus = 'idle' | 'loading' | 'done' | 'error'

export interface ShareState {
  status: ShareStatus
  url?: string
}

function App() {
  const { courses, setCourses, clearCourses } = usePersistedCourses()
  const { i18n } = useTranslation()

  function toggleLang() {
    const next = i18n.language === 'es' ? 'en' : 'es'
    i18n.changeLanguage(next)
    localStorage.setItem('lang', next)
  }

  const [darkMode, setDarkMode] = useState<boolean>(
    () => localStorage.getItem('darkMode') === 'true',
  )
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem('sidebarCollapsed') === 'true',
  )
  const [editingDraft, setEditingDraft] = useState<CourseFormDraft | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  /** When the URL has ?s=<id>, load that shared schedule once on mount. */
  const [isSharedView, setIsSharedView] = useState(false)
  // Volatile: holds the schedule fetched from a shared link, never persisted
  const [sharedCourses, setSharedCourses] = useState<Course[]>([])
  // Persisted share ID — reused so we never duplicate a document in the DB
  const [currentShareId, setCurrentShareId] = useState<string | null>(
    () => localStorage.getItem('shareId'),
  )

  function saveShareId(id: string) {
    setCurrentShareId(id)
    localStorage.setItem('shareId', id)
  }

  function clearShareId() {
    setCurrentShareId(null)
    localStorage.removeItem('shareId')
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const shareId = params.get('s')
    if (!shareId) return

    setIsSharedView(true)
    fetch(`/api/getSchedule?id=${encodeURIComponent(shareId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data: { schedule?: SerializedCourse[] }) => {
        if (!Array.isArray(data.schedule)) throw new Error('invalid data')
        // Load into volatile state — user's own localStorage is untouched
        setSharedCourses(deserializeCourses(data.schedule))
        saveShareId(shareId)
      })
      .catch(() => {
        // Schedule not found or ID invalid — fall back to local mode
        setIsSharedView(false)
        window.history.replaceState({}, '', window.location.pathname)
        setNotFoundToast(true)
        setTimeout(() => setNotFoundToast(false), 4000)
      })
  }, [])

  useEffect(() => {
    localStorage.setItem('darkMode', String(darkMode))
  }, [darkMode])

  // ── Share ──────────────────────────────────────────────────────────────────

  const [shareState, setShareState] = useState<ShareState>({ status: 'idle' })
  const [notFoundToast, setNotFoundToast] = useState(false)

  async function handleShare() {
    if (courses.length === 0) return

    const copyAndShow = async (url: string) => {
      await navigator.clipboard.writeText(url).catch(() => {})
      setShareState({ status: 'done', url })
      setTimeout(() => setShareState({ status: 'idle' }), 2500)
    }

    // Reuse existing share ID if the schedule hasn't been modified
    if (currentShareId) {
      await copyAndShow(`${window.location.origin}?s=${currentShareId}`)
      return
    }
    setShareState({ status: 'loading' })
    try {
      const res = await fetch('/api/createSchedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: serializeCourses(courses) }),
      })
      const data: { id?: string; error?: string } = await res.json()
      if (!res.ok || !data.id) throw new Error(data.error ?? 'Unknown error')
      saveShareId(data.id)
      await copyAndShow(`${window.location.origin}?s=${data.id}`)
    } catch {
      setShareState({ status: 'error' })
    }
  }

  function handleShareClose() {
    setShareState({ status: 'idle' })
  }

  function handleDismissSharedView() {
    // Persist the shared schedule to localStorage now that the user claims it
    setCourses(sharedCourses)
    setSharedCourses([])
    setIsSharedView(false)
    // Remove query param from URL without reloading
    const url = new URL(window.location.href)
    url.searchParams.delete('s')
    window.history.replaceState({}, '', url.pathname)
  }

  // ── Schedule ───────────────────────────────────────────────────────────────

  // In shared view show the fetched schedule; otherwise show the user's own
  const displayedCourses = isSharedView ? sharedCourses : courses

  const schedule = useMemo(() => {
    const s = new Schedule()
    for (const c of displayedCourses) s.tryAddCourse(c)
    return s
  }, [displayedCourses])

  const formSchedule = useMemo(() => {
    const s = new Schedule()
    const editingIds = new Set(editingDraft?.ids ?? [])
    for (const c of displayedCourses) {
      if (!editingIds.has(c.id)) s.tryAddCourse(c)
    }
    return s
  }, [displayedCourses, editingDraft])

  function handleAddCourse(course: Course) {
    clearShareId()
    setCourses((prev) => {
      // Returns true when two HH:MM times are "slot-contiguous":
      // slots run HH:00–HH:50 so the next slot starts at (HH+1):00 (10-min break).
      function slotContiguous(earlier: string, later: string): boolean {
        const [eh, em] = earlier.split(':').map(Number)
        const [lh, lm] = later.split(':').map(Number)
        // Direct adjacency (e.g. 08:50 → 09:00)
        if (em === 50 && lm === 0 && lh === eh + 1) return true
        // Also allow exact same boundary (e.g. 08:00 → 08:00 edge case guard)
        return earlier === later
      }

      // Find an existing course that is an exact duplicate AND contiguous in time
      const mergeIdx = prev.findIndex((existing) => {
        if (existing.name !== course.name) return false
        if (existing.color.hex !== course.color.hex) return false
        if (existing.days.length !== course.days.length) return false
        const aSorted = [...existing.days].sort()
        const bSorted = [...course.days].sort()
        if (!aSorted.every((d, i) => d === bSorted[i])) return false
        // Contiguous: one ends exactly where (slot-wise) the other begins
        return (
          slotContiguous(existing.timeRange.end, course.timeRange.start) ||
          slotContiguous(course.timeRange.end, existing.timeRange.start)
        )
      })

      if (mergeIdx === -1) return [...prev, course]

      const existing = prev[mergeIdx]
      const mergedStart =
        existing.timeRange.start < course.timeRange.start
          ? existing.timeRange.start
          : course.timeRange.start
      const mergedEnd =
        existing.timeRange.end > course.timeRange.end
          ? existing.timeRange.end
          : course.timeRange.end

      const merged = existing.with({
        timeRange: new TimeRange(mergedStart, mergedEnd),
      })

      return prev.map((c, i) => (i === mergeIdx ? merged : c))
    })
    if (window.innerWidth <= 768) {
      setSidebarOpen(false)
      setTimeout(() => {
        mainRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
    }
  }

  function handleClear() {
    clearShareId()
    setEditingDraft(null)
    clearCourses()
  }

  function handleRemoveCourseFromDay(courseId: string, day: Day) {
    clearShareId()
    setEditingDraft((draft) =>
      draft?.ids.includes(courseId) ? null : draft,
    )
    setCourses((prev) =>
      prev.flatMap((c) => {
        if (c.id !== courseId) return [c]
        const newDays = c.days.filter((d) => d !== day)
        if (newDays.length === 0) return []
        return [c.with({ days: newDays })]
      }),
    )
  }

  function handleEditCourse(draft: CourseFormDraft) {
    setEditingDraft(draft)
    setSidebarCollapsed(false)
    setSidebarOpen(true)
  }

  function handleUpdateCourse(courseIds: string[], course: Course) {
    clearShareId()
    const ids = new Set(courseIds)
    setCourses((prev) => [...prev.filter((c) => !ids.has(c.id)), course])
    setEditingDraft(null)
    if (window.innerWidth <= 768) {
      setSidebarOpen(false)
      setTimeout(() => {
        mainRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
    }
  }

  function handleMoveCourse(draft: CourseMoveDraft) {
    clearShareId()
    setEditingDraft(null)
    setCourses((prev) => {
      const movingIds = new Set(draft.ids)
      const remaining = prev.flatMap((course) => {
        if (!movingIds.has(course.id)) return [course]
        const days = course.days.filter((day) => day !== draft.fromDay)
        if (days.length === 0) return []
        return [course.with({ days })]
      })
      const moved = new Course(
        draft.name,
        [draft.toDay],
        new TimeRange(draft.startTime, draft.endTime),
        new CourseColor(draft.color),
      )
      const nextSchedule = new Schedule()
      for (const course of remaining) {
        const check = nextSchedule.tryAddCourse(course)
        if (check.hasConflict) return prev
      }
      const moveCheck = nextSchedule.tryAddCourse(moved)
      if (moveCheck.hasConflict) return prev
      return [...remaining, moved]
    })
  }

  return (
    <div className={`app-layout${darkMode ? ' dark' : ''}`}>
      <aside className={`app-sidebar${sidebarOpen ? ' app-sidebar--open' : ''}${sidebarCollapsed ? ' app-sidebar--collapsed' : ''}`}>
        <div className="app-brand">
          <img src={logo} className="app-brand__icon" alt="ClassGrid logo" />
          <span className="app-brand__name">ClassGrid</span>
          <button
            className="app-brand__dark"
            onClick={() => setDarkMode((d) => !d)}
            aria-label="Toggle dark mode"
          >
            <img src={darkMode ? iconSun : iconMoon} alt="" width="16" height="16" />
          </button>
          <button
            className="app-brand__lang"
            onClick={toggleLang}
            aria-label="Toggle language"
          >
            {i18n.language === 'es' ? 'EN' : 'ES'}
          </button>
          <button
            className="app-brand__collapse"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: '0.85rem', height: '0.85rem', transition: 'transform 0.3s ease', transform: sidebarCollapsed ? 'rotate(180deg)' : 'none' }}>
              <polyline points="10,3 5,8 10,13" />
            </svg>
          </button>
          <button
            className="app-brand__toggle"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle form"
          >
            {sidebarOpen ? '✕' : '＋'}
          </button>
        </div>
        <div className="app-sidebar__body">
          <CourseForm
            key={editingDraft ? `edit-${editingDraft.ids.join('-')}` : 'create'}
            schedule={formSchedule}
            onAdd={handleAddCourse}
            onUpdate={handleUpdateCourse}
            editingDraft={editingDraft}
            onCancelEdit={() => setEditingDraft(null)}
            isSharedView={isSharedView}
          />
        </div>
      </aside>

      <main className="app-main" ref={mainRef}>
        <ScheduleView
          schedule={schedule}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode((d) => !d)}
          onClear={handleClear}
          onRemoveCourseFromDay={handleRemoveCourseFromDay}
          onEditCourse={handleEditCourse}
          onMoveCourse={handleMoveCourse}
          onShare={handleShare}
          shareState={shareState}
          onShareClose={handleShareClose}
          isSharedView={isSharedView}
          onDismissSharedView={handleDismissSharedView}
          notFoundToast={notFoundToast}
          onNotFoundToastClose={() => setNotFoundToast(false)}
        />
      </main>
    </div>
  )
}

export default App
