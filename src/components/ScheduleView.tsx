import { useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { useTranslation, Trans } from "react-i18next";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { DAYS, TimeSlot } from "../domain";
import type { Schedule, Day, Course } from "../domain";
import type { CourseFormDraft } from "./CourseForm";
import iconImage from "../assets/icon-image.svg";
import iconImageWhite from "../assets/icon-image-white.svg";
import iconPdf from "../assets/icon-pdf.svg";
import iconPdfWhite from "../assets/icon-pdf-white.svg";
import iconExcel from "../assets/icon-excel.svg";
import iconExcelWhite from "../assets/icon-excel-white.svg";
import iconMoon from "../assets/icon-moon.svg";
import iconSun from "../assets/icon-sun.svg";
import iconTrash from "../assets/icon-trash.svg";
import iconTrashWhite from "../assets/icon-trash-white.svg";
import iconPencil from "../assets/pencil.svg";
import iconPencilWhite from "../assets/pencil-white.svg";
import iconEraser from "../assets/eraser.svg";
import iconEraserWhite from "../assets/eraser-white.svg";
import "./ScheduleView.css";

const SLOTS = TimeSlot.ALL;
const FIRST_HOUR = 7;
const HEADER_ROW = 1;
const SLOT_ROW_OFFSET = 2;
const TIME_COL = 1;
const DAY_COL_OFFSET = 2;
const MIN_TEXT_CONTRAST = 4.5;
const DRAG_ARM_PRESS_MS = 500;
const DRAG_ARM_MOVE_CANCEL_PX = 14;
const DRAG_AUTOSCROLL_EDGE_PX = 56;
const DRAG_AUTOSCROLL_MAX_STEP = 18;
const EXPORT_PADDING = 24;
const EXPORT_GRID_WIDTH = 1520;

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

function hexToRgb(hex: string): RgbColor {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const [rn, gn, bn] = [r, g, b].map((value) => value / 255);
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
  if (max === gn) h = 60 * ((bn - rn) / delta + 2);
  if (max === bn) h = 60 * ((rn - gn) / delta + 4);

  return { h: (h + 360) % 360, s, l };
}

function hslToRgb({ h, s, l }: HslColor): RgbColor {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - chroma / 2;
  const [rp, gp, bp] =
    h < 60 ? [chroma, x, 0] :
    h < 120 ? [x, chroma, 0] :
    h < 180 ? [0, chroma, x] :
    h < 240 ? [0, x, chroma] :
    h < 300 ? [x, 0, chroma] :
    [chroma, 0, x];

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  const [rs, gs, bs] = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(first: RgbColor, second: RgbColor): number {
  const l1 = relativeLuminance(first);
  const l2 = relativeLuminance(second);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastColor(hex: string): string {
  const background = hexToRgb(hex);
  const backgroundHsl = rgbToHsl(background);
  const black: RgbColor = { r: 0, g: 0, b: 0 };
  const white: RgbColor = { r: 255, g: 255, b: 255 };
  const shouldLighten =
    contrastRatio(background, white) >= contrastRatio(background, black);
  const hue = (backgroundHsl.h + 180) % 360;
  const saturation = backgroundHsl.s;
  const startingLightness = 1 - backgroundHsl.l;
  const step = shouldLighten ? 0.01 : -0.01;

  for (
    let lightness = startingLightness;
    shouldLighten ? lightness <= 1 : lightness >= 0;
    lightness += step
  ) {
    const candidate = hslToRgb({
      h: hue,
      s: saturation,
      l: Math.min(1, Math.max(0, lightness)),
    });
    if (contrastRatio(background, candidate) >= MIN_TEXT_CONTRAST) {
      return rgbToHex(candidate);
    }
  }

  return contrastRatio(background, white) >= contrastRatio(background, black)
    ? "#ffffff"
    : "#000000";
}
interface PendingRemoval {
  courses: Course[];
  name: string;
  day: Day;
  block?: DisplayCourseBlock;
}

type MobileActionMode = "edit" | "delete";

interface PendingMobileAction {
  mode: MobileActionMode;
  block: DisplayCourseBlock;
  day: Day;
}

interface DisplayCourseBlock {
  key: string;
  name: string;
  courses: Course[];
  start: string;
  end: string;
  color: string;
}

interface DragCandidate {
  day: Day;
  dayIndex: number;
  start: string;
  end: string;
  rowStart: number;
  rowSpan: number;
  valid: boolean;
}

interface DragState {
  block: DisplayCourseBlock;
  fromDay: Day;
  pointerId: number;
  rowSpan: number;
  candidate: DragCandidate;
}

interface DragPressState {
  block: DisplayCourseBlock;
  day: Day;
  rowSpan: number;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  target: HTMLDivElement;
}

export interface CourseMoveDraft {
  ids: string[];
  fromDay: Day;
  toDay: Day;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
}

function nextSlotStart(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const nextHour = minutes === 50 ? hours + 1 : hours;
  return `${String(nextHour).padStart(2, "0")}:00`;
}

function isAdjacent(previous: Course, next: Course): boolean {
  return (
    previous.timeRange.end === next.timeRange.start ||
    nextSlotStart(previous.timeRange.end) === next.timeRange.start
  );
}

function canMerge(previous: DisplayCourseBlock, next: Course): boolean {
  const lastCourse = previous.courses[previous.courses.length - 1];
  return (
    previous.name === next.name.trim() &&
    previous.color === next.color.hex &&
    isAdjacent(lastCourse, next)
  );
}

function buildDisplayCourseBlocks(courses: readonly Course[]): DisplayCourseBlock[] {
  const blocks: DisplayCourseBlock[] = [];

  for (const course of courses) {
    const previous = blocks[blocks.length - 1];
    if (previous && canMerge(previous, course)) {
      previous.courses.push(course);
      previous.end = course.timeRange.end;
      previous.key = `${previous.courses.map((c) => c.id).join("-")}`;
      continue;
    }

    blocks.push({
      key: course.id,
      name: course.name.trim(),
      courses: [course],
      start: course.timeRange.start,
      end: course.timeRange.end,
      color: course.color.hex,
    });
  }

  return blocks;
}

function formatSlotStart(slotIndex: number): string {
  return `${String(FIRST_HOUR + slotIndex).padStart(2, "0")}:00`;
}

function formatSlotEnd(slotIndex: number): string {
  return `${String(FIRST_HOUR + slotIndex).padStart(2, "0")}:50`;
}

function slotIndexFromStart(start: string): number {
  return parseInt(start.split(":")[0], 10) - FIRST_HOUR;
}

function slotIndexFromEnd(end: string): number {
  return parseInt(end.split(":")[0], 10) - FIRST_HOUR;
}

function rangesOverlap(
  startSlot: number,
  rowSpan: number,
  block: DisplayCourseBlock,
): boolean {
  const endExclusive = startSlot + rowSpan;
  const blockStart = slotIndexFromStart(block.start);
  const blockEndExclusive = slotIndexFromEnd(block.end) + 1;
  return startSlot < blockEndExclusive && endExclusive > blockStart;
}

interface Props {
  schedule: Schedule;
  darkMode: boolean;
  onToggleDark: () => void;
  onClear: () => void;
  onRemoveCourseFromDay: (courseId: string, day: Day) => void;
  onEditCourse: (draft: CourseFormDraft) => void;
  onMoveCourse: (draft: CourseMoveDraft) => void;
  onShare: () => void;
  shareState: { status: 'idle' | 'loading' | 'done' | 'error'; url?: string };
  onShareClose: () => void;
  isSharedView: boolean;
  onDismissSharedView: () => void;
  notFoundToast: boolean;
  onNotFoundToastClose: () => void;
}

export default function ScheduleView({
  schedule,
  darkMode,
  onToggleDark,
  onClear,
  onRemoveCourseFromDay,
  onEditCourse,
  onMoveCourse,
  onShare,
  shareState,
  onShareClose,
  isSharedView,
  onDismissSharedView,
  notFoundToast,
  onNotFoundToastClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingClear, setPendingClear] = useState(false);
  const [mobileActionMode, setMobileActionMode] =
    useState<MobileActionMode | null>(null);
  const [pendingMobileAction, setPendingMobileAction] =
    useState<PendingMobileAction | null>(null);

  const [tooltip, setTooltip] = useState<{
    block: DisplayCourseBlock;
    day: Day;
    x: number;
    blockTop: number;
    blockBottom: number;
    tipBelow: boolean;
  } | null>(null);

  function toggleLang() {
    const next = i18n.language === "es" ? "en" : "es";
    i18n.changeLanguage(next);
    localStorage.setItem("lang", next);
  }
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(
    null,
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [armingDrag, setArmingDrag] = useState<DragPressState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragPressRef = useRef<DragPressState | null>(null);
  const dragArmTimerRef = useRef<number | null>(null);
  const dragAutoScrollRef = useRef<{
    frameId: number | null;
    pointerX: number;
    pointerY: number;
    active: boolean;
  }>({
    frameId: null,
    pointerX: 0,
    pointerY: 0,
    active: false,
  });

  function buildEditDraft(block: DisplayCourseBlock, day: Day): CourseFormDraft {
    const source = block.courses[0];
    return {
      ids: block.courses.map((course) => course.id),
      name: block.name,
      days: block.courses.length === 1 ? [...source.days] : [day],
      startTime: block.start,
      endTime: block.end,
      color: block.color,
    };
  }

  const displayBlocksByDay = useMemo(() => {
    const entries = DAYS.map((day) => [
      day,
      buildDisplayCourseBlocks(schedule.getCoursesForDay(day)),
    ] as const);
    return new Map<Day, DisplayCourseBlock[]>(entries);
  }, [schedule]);

  function candidateFromPointer(
    clientX: number,
    clientY: number,
    rowSpan: number,
    draggedIds: Set<string>,
    fromDay: Day,
  ): DragCandidate | null {
    const grid = gridRef.current;
    if (!grid) return null;

    const rect = grid.getBoundingClientRect();
    const dayWidth = (rect.width - 64) / DAYS.length;
    const x = clientX - rect.left - 64;
    const y = clientY - rect.top - 44;
    const dayIndex = Math.min(
      DAYS.length - 1,
      Math.max(0, Math.floor(x / dayWidth)),
    );
    const maxStart = SLOTS.length - rowSpan;
    const startSlot = Math.min(
      maxStart,
      Math.max(0, Math.floor(y / 56)),
    );
    const day = DAYS[dayIndex];
    const valid = !(displayBlocksByDay.get(day) ?? []).some((block) => {
      if (
        day === fromDay &&
        block.courses.some((course) => draggedIds.has(course.id))
      ) {
        return false;
      }
      return rangesOverlap(startSlot, rowSpan, block);
    });

    return {
      day,
      dayIndex,
      start: formatSlotStart(startSlot),
      end: formatSlotEnd(startSlot + rowSpan - 1),
      rowStart: startSlot + SLOT_ROW_OFFSET,
      rowSpan,
      valid,
    };
  }

  function openCourseActions(block: DisplayCourseBlock, day: Day) {
    setPendingRemoval({
      courses: block.courses,
      name: block.name,
      day,
      block,
    });
  }

  function setDragState(nextDrag: DragState | null) {
    dragStateRef.current = nextDrag;
    setDrag(nextDrag);
  }

  function openMobileCourseAction(block: DisplayCourseBlock, day: Day) {
    if (!mobileActionMode || isSharedView) return;
    setPendingMobileAction({
      mode: mobileActionMode,
      block,
      day,
    });
  }

  function removeBlockFromDay(block: DisplayCourseBlock, day: Day) {
    onRemoveCourseFromDay(block.courses[0].id, day);
    block.courses.slice(1).forEach((course) => {
      onRemoveCourseFromDay(course.id, day);
    });
  }

  function clearDragPress() {
    if (dragArmTimerRef.current !== null) {
      window.clearTimeout(dragArmTimerRef.current);
      dragArmTimerRef.current = null;
    }
    dragPressRef.current = null;
    setArmingDrag(null);
  }

  function stopDragAutoScroll() {
    dragAutoScrollRef.current.active = false;
    if (dragAutoScrollRef.current.frameId !== null) {
      window.cancelAnimationFrame(dragAutoScrollRef.current.frameId);
      dragAutoScrollRef.current.frameId = null;
    }
  }

  function runDragAutoScroll() {
    const state = dragAutoScrollRef.current;
    const scroller = scrollRef.current;
    state.frameId = null;

    if (!state.active || !scroller) return;

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    if (maxScrollLeft <= 0) {
      state.active = false;
      return;
    }

    const rect = scroller.getBoundingClientRect();
    const distanceFromLeft = state.pointerX - rect.left;
    const distanceFromRight = rect.right - state.pointerX;
    let direction = 0;
    let intensity = 0;

    if (distanceFromLeft < DRAG_AUTOSCROLL_EDGE_PX) {
      direction = -1;
      intensity = (DRAG_AUTOSCROLL_EDGE_PX - distanceFromLeft) /
        DRAG_AUTOSCROLL_EDGE_PX;
    } else if (distanceFromRight < DRAG_AUTOSCROLL_EDGE_PX) {
      direction = 1;
      intensity = (DRAG_AUTOSCROLL_EDGE_PX - distanceFromRight) /
        DRAG_AUTOSCROLL_EDGE_PX;
    }

    let didScroll = false;
    if (direction !== 0) {
      const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(
          0,
          scroller.scrollLeft +
            direction * Math.ceil(DRAG_AUTOSCROLL_MAX_STEP * intensity),
        ),
      );
      if (nextScrollLeft !== scroller.scrollLeft) {
        scroller.scrollLeft = nextScrollLeft;
        didScroll = true;
      }
    }

    const activeDrag = dragStateRef.current;
    if (didScroll && activeDrag) {
      const draggedIds = new Set(
        activeDrag.block.courses.map((course) => course.id),
      );
      const candidate = candidateFromPointer(
        state.pointerX,
        state.pointerY,
        activeDrag.rowSpan,
        draggedIds,
        activeDrag.fromDay,
      );
      if (candidate) {
        setDragState({ ...activeDrag, candidate });
      }
    }

    state.frameId = window.requestAnimationFrame(runDragAutoScroll);
  }

  function updateDragAutoScroll(clientX: number, clientY: number) {
    const state = dragAutoScrollRef.current;
    state.pointerX = clientX;
    state.pointerY = clientY;
    state.active = true;
    if (state.frameId === null) {
      state.frameId = window.requestAnimationFrame(runDragAutoScroll);
    }
  }

  function startDragFromPoint(
    target: HTMLDivElement,
    pointerId: number,
    block: DisplayCourseBlock,
    day: Day,
    rowSpan: number,
    clientX: number,
    clientY: number,
  ) {
    if (isSharedView) return;
    if (!target.hasPointerCapture(pointerId)) {
      target.setPointerCapture(pointerId);
    }
    setTooltip(null);
    const draggedIds = new Set(block.courses.map((course) => course.id));
    const candidate = candidateFromPointer(
      clientX,
      clientY,
      rowSpan,
      draggedIds,
      day,
    );
    if (!candidate) return;
    updateDragAutoScroll(clientX, clientY);
    setDragState({
      block,
      fromDay: day,
      pointerId,
      rowSpan,
      candidate,
    });
  }

  function beginDrag(
    event: React.PointerEvent<HTMLDivElement>,
    block: DisplayCourseBlock,
    day: Day,
    rowSpan: number,
  ) {
    if (event.button !== 0 || isSharedView) return;
    if (mobileActionMode) {
      return;
    }
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    clearDragPress();
    const press = {
      block,
      day,
      rowSpan,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      target,
    };
    dragPressRef.current = press;
    setArmingDrag(press);
    dragArmTimerRef.current = window.setTimeout(() => {
      const activePress = dragPressRef.current;
      if (!activePress || activePress.pointerId !== event.pointerId) return;
      startDragFromPoint(
        activePress.target,
        activePress.pointerId,
        activePress.block,
        activePress.day,
        activePress.rowSpan,
        activePress.startX,
        activePress.startY,
      );
      clearDragPress();
    }, DRAG_ARM_PRESS_MS);
  }

  function updateDrag(event: React.PointerEvent<HTMLDivElement>) {
    const dragPress = dragPressRef.current;
    if (dragPress && dragPress.pointerId === event.pointerId && !drag) {
      const distance = Math.hypot(
        event.clientX - dragPress.startX,
        event.clientY - dragPress.startY,
      );
      if (distance > DRAG_ARM_MOVE_CANCEL_PX) {
        clearDragPress();
      }
      return;
    }

    if (!drag || drag.pointerId !== event.pointerId) return;
    const draggedIds = new Set(drag.block.courses.map((course) => course.id));
    const candidate = candidateFromPointer(
      event.clientX,
      event.clientY,
      drag.rowSpan,
      draggedIds,
      drag.fromDay,
    );
    if (!candidate) return;
    updateDragAutoScroll(event.clientX, event.clientY);
    setDragState({ ...drag, candidate });
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    const dragPress = dragPressRef.current;
    if (dragPress && dragPress.pointerId === event.pointerId && !drag) {
      clearDragPress();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    clearDragPress();
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const candidate = drag.candidate;
    if (candidate.valid) {
      onMoveCourse({
        ids: drag.block.courses.map((course) => course.id),
        fromDay: drag.fromDay,
        toDay: candidate.day,
        name: drag.block.name,
        startTime: candidate.start,
        endTime: candidate.end,
        color: drag.block.color,
      });
    }
    stopDragAutoScroll();
    setDragState(null);
  }

  function cancelPointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    clearDragPress();
    stopDragAutoScroll();
    if (
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
  }

  /**
   * Builds an off-screen capture wrapper with padding that contains a clone of
   * the grid. The wrapper uses `position: fixed; left: -9999px; top: 0` so
   * html2canvas anchors it at Y=0 in viewport coordinates — avoiding the
   * bottom-clip that happens when elements are placed at large negative Y
   * values (absolute -99999px puts the element outside h2c's render window).
   *
   * The grid clone has its full scrollHeight locked in as an explicit height so
   * html2canvas never underestimates the element size.
   *
   * Returns { wrapper, cleanup }.
   */
  function buildCaptureClone(): { wrapper: HTMLElement; cleanup: () => void } {
    const grid = gridRef.current!;
    const cs = window.getComputedStyle(grid);
    const minGridWidth = 64 + DAYS.length * 80;
    const gridWidth = Math.max(minGridWidth, EXPORT_GRID_WIDTH);
    const exportWidth = gridWidth + 2 * EXPORT_PADDING;

    // Padded wrapper — this is what html2canvas will capture
    const wrapper = document.createElement("div");
    wrapper.style.cssText = [
      "position: fixed",
      "top: 0",
      "left: -9999px",
      `padding: ${EXPORT_PADDING}px`,
      `background: ${darkMode ? "#0f172a" : "#f8fafc"}`,
      "box-sizing: border-box",
      `width: ${exportWidth}px`,
      "height: auto",
      "overflow: visible",
    ].join("; ");

    // Clone the grid
    const clone = grid.cloneNode(true) as HTMLElement;
    const fullHeight = grid.scrollHeight;
    clone.classList.add("sv-grid--export");

    clone.style.cssText = "";          // wipe inline styles from original
    clone.style.display = "grid";
    // Use the original CSS definition (not the computed resolved pixel values)
    // so that 1fr columns re-expand to fill the new wider width.
    clone.style.gridTemplateColumns = "64px repeat(7, minmax(80px, 1fr))";
    clone.style.gridTemplateRows = cs.gridTemplateRows;
    clone.style.width = `${gridWidth}px`;
    clone.style.minWidth = `${gridWidth}px`;
    clone.style.height = `${fullHeight}px`;  // explicit — prevents h2c from clipping
    clone.style.position = "relative";
    clone.style.overflow = "visible";

    // Freeze entry animations
    clone.querySelectorAll<HTMLElement>(".sv-course-block").forEach((el) => {
      el.style.animation = "none";
      el.style.transform = "scaleY(1)";
      el.style.opacity = "1";
    });

    // Sticky → relative so headers are laid out in normal flow
    clone
      .querySelectorAll<HTMLElement>(".sv-corner, .sv-day-header, .sv-time-label")
      .forEach((el) => { el.style.position = "relative"; });

    // Hide tooltips
    clone.querySelectorAll<HTMLElement>(".sv-tooltip").forEach((el) => {
      el.style.display = "none";
    });

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    return {
      wrapper,
      cleanup: () => { if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper); },
    };
  }

  async function exportImage() {
    if (!gridRef.current) return;
    const { wrapper, cleanup } = buildCaptureClone();
    try {
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: wrapper.scrollWidth,
        windowHeight: wrapper.scrollHeight,
      });
      const link = document.createElement("a");
      link.download = "horario.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      cleanup();
    }
  }

  async function exportPDF() {
    if (!gridRef.current) return;
    const { wrapper, cleanup } = buildCaptureClone();
    try {
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: wrapper.scrollWidth,
        windowHeight: wrapper.scrollHeight,
      });
      const imgData = canvas.toDataURL("image/png");
      // Use raw canvas pixel dimensions + px_scaling hotfix to prevent jsPDF's
      // internal 72/96 DPI downscale from trimming the last rows of the page.
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
        hotfixes: ["px_scaling"],
      });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save("horario.pdf");
    } finally {
      cleanup();
    }
  }

  function exportExcel() {
    const header = [
      t("scheduleView.timeCol"),
      ...DAYS.map((d) => t(`days.${d}`)),
    ];
    const rows = SLOTS.map((slot) => {
      const slotHour = parseInt(slot.start.split(":")[0], 10);
      const row: string[] = [`${slot.start} - ${slot.end}`];
      for (const day of DAYS) {
        const course = schedule
          .getCoursesForDay(day)
          .find((c) => {
            const startHour = parseInt(c.timeRange.start.split(":")[0], 10);
            const endHour = parseInt(c.timeRange.end.split(":")[0], 10);
            return slotHour >= startHour && slotHour <= endHour;
          });
        row.push(course ? course.name : "");
      }
      return row;
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Horario");
    XLSX.writeFile(wb, "horario.xlsx");
  }

  return (
    <section className="schedule-view">
      <div className="sv-toolbar">
        <h2 className="sv-toolbar__title">{t("scheduleView.title")}</h2>
        <div className="sv-toolbar__actions">
          <button
            className="sv-btn sv-btn--w-lg"
            onClick={exportImage}
            title={t("scheduleView.exportImageTitle")}
          >
            <img
              className="sv-btn__icon"
              src={darkMode ? iconImageWhite : iconImage}
              alt=""
            />
            <span className="sv-btn__label">
              {t("scheduleView.exportImage")}
            </span>
          </button>
          <button
            className="sv-btn sv-btn--w-md"
            onClick={exportPDF}
            title={t("scheduleView.exportPdfTitle")}
          >
            <img
              className="sv-btn__icon"
              src={darkMode ? iconPdfWhite : iconPdf}
              alt=""
            />
            <span className="sv-btn__label">{t("scheduleView.exportPdf")}</span>
          </button>
          <button
            className="sv-btn sv-btn--w-md"
            onClick={exportExcel}
            title={t("scheduleView.exportExcelTitle")}
          >
            <img
              className="sv-btn__icon"
              src={darkMode ? iconExcelWhite : iconExcel}
              alt=""
            />
            <span className="sv-btn__label">
              {t("scheduleView.exportExcel")}
            </span>
          </button>
          <button
            className="sv-btn sv-btn--w-md sv-btn--share"
            onClick={onShare}
            disabled={shareState.status === "loading"}
            title={t("scheduleView.shareTitle")}
          >
            <svg className="sv-btn__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="15" cy="4" r="2"/>
              <circle cx="5" cy="10" r="2"/>
              <circle cx="15" cy="16" r="2"/>
              <line x1="7" y1="11" x2="13" y2="15"/>
              <line x1="13" y1="5" x2="7" y2="9"/>
            </svg>
            <span className="sv-btn__label">
              {shareState.status === "loading"
                ? t("scheduleView.shareLoading")
                : t("scheduleView.shareLabel")}
            </span>
          </button>
          <div className="sv-toolbar__sep" />

          <button
            className={`sv-btn sv-btn--mobile-action${mobileActionMode === "edit" ? " sv-btn--active" : ""}`}
            onClick={() =>
              setMobileActionMode((mode) => (mode === "edit" ? null : "edit"))
            }
            title={t("scheduleView.editModeTitle")}
            aria-pressed={mobileActionMode === "edit"}
            disabled={isSharedView}
          >
            <img
              className="sv-btn__icon"
              src={
                mobileActionMode === "edit"
                  ? iconPencilWhite
                  : darkMode
                    ? iconPencilWhite
                    : iconPencil
              }
              alt=""
            />
          </button>
          <button
            className={`sv-btn sv-btn--mobile-action sv-btn--mobile-delete${mobileActionMode === "delete" ? " sv-btn--active" : ""}`}
            onClick={() =>
              setMobileActionMode((mode) =>
                mode === "delete" ? null : "delete",
              )
            }
            title={t("scheduleView.deleteModeTitle")}
            aria-pressed={mobileActionMode === "delete"}
            disabled={isSharedView}
          >
            <img
              className="sv-btn__icon"
              src={
                mobileActionMode === "delete"
                  ? iconEraserWhite
                  : darkMode
                    ? iconEraserWhite
                    : iconEraser
              }
              alt=""
            />
          </button>

          <button
            className={`sv-btn sv-btn--dark${darkMode ? " sv-btn--active" : ""}`}
            onClick={onToggleDark}
            title={t("scheduleView.darkModeTitle")}
          >
            <img
              className="sv-btn__icon"
              src={darkMode ? iconSun : iconMoon}
              alt=""
            />
          </button>
          <button
            className="sv-btn sv-btn--danger sv-btn--w-md"
            onClick={() => setPendingClear(true)}
            title={t("scheduleView.clearTitle")}
            disabled={isSharedView}
          >
            <img
              className="sv-btn__icon"
              src={darkMode ? iconTrashWhite : iconTrash}
              alt=""
            />
          </button>
          <button
            className="sv-btn sv-btn--w-sm sv-btn--lang"
            onClick={toggleLang}
            title={t("lang." + (i18n.language === "es" ? "en" : "es"))}
          >
            <span className="sv-btn__label">
              {i18n.language === "es" ? "EN" : "ES"}
            </span>
          </button>
        </div>
      </div>

      <div className="sv-scroll" ref={scrollRef}>
        <div
          className="sv-grid"
          ref={gridRef}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            className="sv-corner"
            style={{ gridColumn: TIME_COL, gridRow: HEADER_ROW }}
          />
          {DAYS.map((day, di) => (
            <div
              key={day}
              className="sv-day-header"
              style={{ gridColumn: di + DAY_COL_OFFSET, gridRow: HEADER_ROW }}
            >
              <span className="sv-day-abbr">{t(`dayAbbr.${day}`)}</span>
              <span className="sv-day-full">{t(`days.${day}`)}</span>
            </div>
          ))}
          {SLOTS.map((slot, si) => {
            const gridRow = si + SLOT_ROW_OFFSET;
            return (
              <Fragment key={si}>
                <div
                  key={`t-${si}`}
                  className="sv-time-label"
                  style={{ gridColumn: TIME_COL, gridRow }}
                >
                  <span className="sv-time-label__start">{slot.start}</span>
                  <span className="sv-time-label__end">{slot.end}</span>
                </div>
                {DAYS.map((_day, di) => (
                  <div
                    key={`bg-${si}-${di}`}
                    className="sv-bg-cell"
                    style={{ gridColumn: di + DAY_COL_OFFSET, gridRow }}
                  />
                ))}
              </Fragment>
            );
          })}
          {DAYS.map((day, di) =>
            (displayBlocksByDay.get(day) ?? []).map((block) => {
              const startHour = parseInt(
                block.start.split(":")[0],
                10,
              );
              const endHour = parseInt(block.end.split(":")[0], 10);
              const rowStart = startHour - FIRST_HOUR + SLOT_ROW_OFFSET;
              const rowSpan = endHour - startHour + 1;
              const fg = contrastColor(block.color);
              const tipBelow = rowStart - SLOT_ROW_OFFSET < SLOTS.length / 2;
              const isDragging =
                drag?.fromDay === day &&
                drag.block.courses.some((dragged) =>
                  block.courses.some((course) => course.id === dragged.id),
                );
              const isArmingDrag =
                armingDrag?.day === day &&
                armingDrag.block.courses.some((armed) =>
                  block.courses.some((course) => course.id === armed.id),
                );
              return (
                <div
                  key={`${block.key}-${day}`}
                  className={`sv-course-block${tipBelow ? " sv-course-block--tip-below" : ""}${isDragging ? " sv-course-block--dragging" : ""}${isArmingDrag ? " sv-course-block--arming" : ""}`}
                  style={{
                    gridColumn: di + DAY_COL_OFFSET,
                    gridRow: `${rowStart} / span ${rowSpan}`,
                    backgroundColor: block.color,
                    color: fg,
                    borderColor:
                      fg === "#ffffff"
                        ? "rgba(255,255,255,0.25)"
                        : "rgba(0,0,0,0.12)",
                    cursor: isSharedView
                      ? "default"
                      : mobileActionMode
                        ? "pointer"
                        : "grab",
                  }}
                  onPointerDown={(event) => beginDrag(event, block, day, rowSpan)}
                  onPointerMove={updateDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={cancelPointerInteraction}
                  onClick={() => {
                    if (mobileActionMode) {
                      openMobileCourseAction(block, day);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    const isTouchContextMenu =
                      window.matchMedia("(pointer: coarse)").matches;
                    if (!isSharedView && !isTouchContextMenu) {
                      openCourseActions(block, day);
                    }
                  }}
                  onMouseEnter={(e) => {
                    if (drag) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTooltip({
                      block,
                      day,
                      x: rect.left + rect.width / 2,
                      blockTop: rect.top,
                      blockBottom: rect.bottom,
                      tipBelow,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <span
                    className="sv-course-name"
                    style={
                      rowSpan > 1
                        ? {
                            whiteSpace: "normal",
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: rowSpan,
                            overflow: "hidden",
                            textOverflow: "unset",
                          }
                        : undefined
                    }
                  >
                    {block.name}
                  </span>

                </div>
              );
            }),
          )}
          {drag && (
            <div
              className={`sv-drag-preview${drag.candidate.valid ? " sv-drag-preview--valid" : " sv-drag-preview--invalid"}`}
              style={{
                gridColumn: drag.candidate.dayIndex + DAY_COL_OFFSET,
                gridRow: `${drag.candidate.rowStart} / span ${drag.candidate.rowSpan}`,
                backgroundColor: drag.block.color,
                color: contrastColor(drag.block.color),
              }}
            >
              <span className="sv-course-name">{drag.block.name}</span>
              <span className="sv-drag-preview__meta">
                {t(`dayAbbr.${drag.candidate.day}`)} {drag.candidate.start} - {drag.candidate.end}
              </span>
            </div>
          )}
        </div>
      </div>

      {pendingClear && (
        <div
          className="sv-modal-overlay"
          onClick={() => setPendingClear(false)}
        >
          <div className="sv-modal" onClick={(e) => e.stopPropagation()}>
            <p className="sv-modal__message">
              {t("scheduleView.clearConfirmMessage")}
            </p>
            <div className="sv-modal__actions">
              <button
                className="sv-modal__btn sv-modal__btn--cancel"
                onClick={() => setPendingClear(false)}
              >
                {t("scheduleView.cancel")}
              </button>
              <button
                className="sv-modal__btn sv-modal__btn--confirm"
                onClick={() => {
                  onClear();
                  setPendingClear(false);
                }}
              >
                {t("scheduleView.clearConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoval && (
        <div
          className="sv-modal-overlay"
          onClick={() => setPendingRemoval(null)}
        >
          <div className="sv-modal" onClick={(e) => e.stopPropagation()}>
            <div
              className="sv-modal__swatch"
              style={{ backgroundColor: pendingRemoval.courses[0].color.hex }}
            />
            <h3 className="sv-modal__title">
              {pendingRemoval.name}
            </h3>
            <p className="sv-modal__message">
              <Trans
                i18nKey="scheduleView.courseActionMessage"
                values={{
                  course: pendingRemoval.name,
                  day: t(`days.${pendingRemoval.day}`),
                }}
                components={[<></>, <strong />, <></>, <strong />]}
              />
            </p>
            <div className="sv-modal__actions">
              <button
                className="sv-modal__btn sv-modal__btn--edit"
                onClick={() => {
                  onEditCourse(
                    buildEditDraft(
                      {
                        key:
                          pendingRemoval.block?.key ??
                          pendingRemoval.courses.map((c) => c.id).join("-"),
                        name: pendingRemoval.name,
                        courses: pendingRemoval.courses,
                        start:
                          pendingRemoval.block?.start ??
                          pendingRemoval.courses[0].timeRange.start,
                        end:
                          pendingRemoval.block?.end ??
                          pendingRemoval.courses[pendingRemoval.courses.length - 1].timeRange.end,
                        color:
                          pendingRemoval.block?.color ??
                          pendingRemoval.courses[0].color.hex,
                      },
                      pendingRemoval.day,
                    ),
                  );
                  setPendingRemoval(null);
                }}
              >
                {t("scheduleView.edit")}
              </button>
              <button
                className="sv-modal__btn sv-modal__btn--cancel"
                onClick={() => setPendingRemoval(null)}
              >
                {t("scheduleView.cancel")}
              </button>
              <button
                className="sv-modal__btn sv-modal__btn--confirm"
                onClick={() => {
                  removeBlockFromDay(
                    {
                      key:
                        pendingRemoval.block?.key ??
                        pendingRemoval.courses.map((c) => c.id).join("-"),
                      name: pendingRemoval.name,
                      courses: pendingRemoval.courses,
                      start:
                        pendingRemoval.block?.start ??
                        pendingRemoval.courses[0].timeRange.start,
                      end:
                        pendingRemoval.block?.end ??
                        pendingRemoval.courses[pendingRemoval.courses.length - 1]
                          .timeRange.end,
                      color:
                        pendingRemoval.block?.color ??
                        pendingRemoval.courses[0].color.hex,
                    },
                    pendingRemoval.day,
                  );
                  setPendingRemoval(null);
                }}
              >
                {t("scheduleView.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingMobileAction && (
        <div
          className="sv-modal-overlay"
          onClick={() => setPendingMobileAction(null)}
        >
          <div className="sv-modal" onClick={(e) => e.stopPropagation()}>
            <div
              className="sv-modal__swatch"
              style={{ backgroundColor: pendingMobileAction.block.color }}
            />
            <h3 className="sv-modal__title">
              {pendingMobileAction.block.name}
            </h3>
            <p className="sv-modal__message">
              <Trans
                i18nKey={
                  pendingMobileAction.mode === "edit"
                    ? "scheduleView.mobileEditMessage"
                    : "scheduleView.mobileDeleteMessage"
                }
                values={{
                  course: pendingMobileAction.block.name,
                  day: t(`days.${pendingMobileAction.day}`),
                }}
                components={[<></>, <strong />, <></>, <strong />]}
              />
            </p>
            <div className="sv-modal__actions">
              <button
                className="sv-modal__btn sv-modal__btn--cancel"
                onClick={() => setPendingMobileAction(null)}
              >
                {t("scheduleView.cancel")}
              </button>
              <button
                className={
                  pendingMobileAction.mode === "edit"
                    ? "sv-modal__btn sv-modal__btn--edit"
                    : "sv-modal__btn sv-modal__btn--confirm"
                }
                onClick={() => {
                  if (pendingMobileAction.mode === "edit") {
                    onEditCourse(
                      buildEditDraft(
                        pendingMobileAction.block,
                        pendingMobileAction.day,
                      ),
                    );
                  } else {
                    removeBlockFromDay(
                      pendingMobileAction.block,
                      pendingMobileAction.day,
                    );
                  }
                  setPendingMobileAction(null);
                }}
              >
                {pendingMobileAction.mode === "edit"
                  ? t("scheduleView.mobileEditConfirm")
                  : t("scheduleView.mobileDeleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {notFoundToast && (
        <div className="sv-toast sv-toast--error">
          <span>{t("scheduleView.scheduleNotFound")}</span>
          <button className="sv-toast__close" onClick={onNotFoundToastClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
      )}

      {(shareState.status === "done" || shareState.status === "error") && (
        <div className={`sv-toast sv-toast--${shareState.status}`}>
          <span>
            {shareState.status === "done"
              ? t("scheduleView.shareDone")
              : t("scheduleView.shareError")}
          </span>
          {shareState.status === "error" && (
            <button className="sv-toast__close" onClick={onShareClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>
      )}

      {tooltip && createPortal(
        <div
          className={`sv-tooltip-portal${tooltip.tipBelow ? " sv-tooltip-portal--below" : ""}`}
          style={{
            left: tooltip.x,
            ...(tooltip.tipBelow
              ? { top: tooltip.blockBottom + 7 }
              : { top: tooltip.blockTop - 7 }),
          }}
        >
          <strong>{tooltip.block.name}</strong>
          <span>
            {tooltip.block.start} &ndash; {tooltip.block.end}
          </span>
          <span className="sv-tooltip-days">
            {t(`days.${tooltip.day}`)}
          </span>
        </div>,
        document.body,
      )}

      {isSharedView && (
        <div className="sv-shared-banner">
          <span>{t("scheduleView.shareReadOnly")}</span>
          <button
            className="sv-shared-banner__btn"
            onClick={onDismissSharedView}
          >
            {t("scheduleView.shareReadOnlyDismiss")}
          </button>
        </div>
      )}
    </section>
  );
}
