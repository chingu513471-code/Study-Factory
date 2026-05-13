import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Plus, Search, UserPlus, CheckSquare, Square, Trash, Save, CornerDownLeft } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { format, addDays, getDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import EmbeddedCalendar from '../components/EmbeddedCalendar';
import { parseContentWithReplies } from '../utils/replyContent';
import StaffTaskBoard from './StaffTaskBoard';

const getKstNowParts = (timestamp = Date.now()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(new Date(timestamp));

    const partMap = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            partMap[part.type] = part.value;
        }
    });

    return {
        dateStr: `${partMap.year}-${partMap.month}-${partMap.day}`,
        hour: Number(partMap.hour || 0),
        minute: Number(partMap.minute || 0)
    };
};

const parseSideDishAmount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const normalizeSideDishItems = (items) => (
    Array.isArray(items)
        ? items
            .map((item) => ({
                name: String(item?.name || '').trim(),
                amount: parseSideDishAmount(item?.amount)
            }))
            .filter((item) => item.name && item.amount > 0)
        : []
);

const normalizeSideDishBatches = (items, fallbackSubmittedAt = null) => {
    if (!Array.isArray(items) || items.length === 0) return [];

    const looksLikeBatchList = items.some((item) => Array.isArray(item?.items));
    if (looksLikeBatchList) {
        return items
            .map((batch, index) => {
                const normalizedItems = normalizeSideDishItems(batch?.items);
                if (normalizedItems.length === 0) return null;

                return {
                    batchId: String(batch?.batchId || `batch-${index}`),
                    items: normalizedItems,
                    submittedAt: batch?.submittedAt || fallbackSubmittedAt || null
                };
            })
            .filter(Boolean);
    }

    const normalizedItems = normalizeSideDishItems(items);
    if (normalizedItems.length === 0) return [];

    return [{
        batchId: 'legacy-batch-0',
        items: normalizedItems,
        submittedAt: fallbackSubmittedAt || null
    }];
};

const createDateFromYmd = (ymd) => {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(year, month - 1, day);
};

const formatYmdToKorean = (ymd) => {
    const [year, month, day] = (ymd || '').split('-').map(Number);
    if (!year || !month || !day) return ymd || '';
    return `${year}년 ${month}월 ${day}일`;
};

const toKstDateStrFromIso = (isoString) => {
    if (!isoString) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date(isoString));

    const map = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    });

    return `${map.year}-${map.month}-${map.day}`;
};

const shiftYmdByDays = (ymd, days) => {
    if (!ymd) return '';
    const base = createDateFromYmd(ymd);
    return format(addDays(base, days), 'yyyy-MM-dd');
};

const formatNewBeverage2Text = (row) => {
    if (!row) return '-';
    if (row.beverage_2_choice === '없음') return '없음';

    let beverage2 = row.beverage_2_choice === '기타'
        ? (row.beverage_2_custom || '기타')
        : row.beverage_2_choice;

    if (row.use_personal_tumbler) {
        beverage2 = `텀블러 ${beverage2}`;
    }

    return beverage2;
};

const VACATION_STATUS_KEYS = ['vacation_full', 'vacation_half_am', 'vacation_half_pm', 'vacation_cancel'];
const POPUP_PRESET_REASONS = ['지각', '조퇴', '외출', '이동', '시험', '컨디션'];

// Status Selection Popup
const StatusPopup = ({
    popup,
    onClose,
    onToggleDate,
    onCalendarMonthChange,
    onTogglePeriod,
    onReasonSelect,
    onInstantCancel,
    onPresetReasonSelect,
    onCustomReasonChange,
    onSubmit,
    onFixedSubmit
}) => {
    if (!popup.open) return null;

    const { user, selectedDates, calendarMonth, selectedPeriods, selectedReason, selectedPresetReason, customReason } = popup;
    const isAllSelected = selectedPeriods.length === 7;
    const isSelected = (reason) => selectedReason === reason;
    const isPresetSelected = (reason) => selectedPresetReason === reason;

    return createPortal(
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.5)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px'
            }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'white',
                    borderRadius: '16px',
                    padding: '20px',
                    width: 'min(520px, calc(100vw - 24px))',
                    maxHeight: '85vh',
                    overflowY: 'auto',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                }}
            >
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2d3748', marginBottom: '15px', textAlign: 'center' }}>
                    {user?.name || ''} 출석 상태 선택
                </h3>

                <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#4a5568' }}>날짜</label>
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '8px' }}>
                        <EmbeddedCalendar
                            selectedDates={selectedDates}
                            onSelectDate={onToggleDate}
                            currentMonth={calendarMonth}
                            onMonthChange={onCalendarMonthChange}
                            compact={true}
                            showEvents={false}
                        />
                    </div>
                    <div style={{ textAlign: 'center', marginTop: '6px', color: '#718096', fontSize: '0.82rem' }}>
                        {selectedDates.length > 0 ? `${selectedDates.length}일 선택됨` : '날짜를 선택하세요 (다중 선택 가능)'}
                    </div>
                </div>

                <div style={{ margin: '15px 0', borderTop: '1px solid #e2e8f0' }}></div>

                <div style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#4a5568' }}>교시</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                        {[1, 2, 3, 4, 5, 6, 7].map((p) => (
                            <button
                                key={p}
                                onClick={() => onTogglePeriod(p)}
                                style={{
                                    padding: '10px 0',
                                    borderRadius: '8px',
                                    border: selectedPeriods.includes(p) ? '2px solid #3182ce' : '1px solid #e2e8f0',
                                    background: selectedPeriods.includes(p) ? '#ebf8ff' : 'white',
                                    color: selectedPeriods.includes(p) ? '#2c5282' : '#a0aec0',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem'
                                }}
                            >
                                {p}
                            </button>
                        ))}
                        <button
                            onClick={() => onTogglePeriod('all')}
                            style={{
                                gridColumn: 'span 7',
                                marginTop: '4px',
                                padding: '10px',
                                borderRadius: '8px',
                                border: isAllSelected ? '2px solid #3182ce' : '1px solid #e2e8f0',
                                background: isAllSelected ? '#ebf8ff' : 'white',
                                color: isAllSelected ? '#2c5282' : '#a0aec0',
                                fontWeight: 'bold',
                                cursor: 'pointer'
                            }}
                        >
                            전체 선택
                        </button>
                    </div>
                </div>

                <div style={{ margin: '15px 0', borderTop: '1px solid #e2e8f0' }}></div>

                <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#4a5568' }}>사유 선택</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                        {POPUP_PRESET_REASONS.map((reason) => (
                            <button
                                key={reason}
                                onClick={() => onPresetReasonSelect(reason)}
                                style={{
                                    padding: '9px 0',
                                    borderRadius: '9px',
                                    border: isPresetSelected(reason) ? '2px solid #3182ce' : '1px solid #e2e8f0',
                                    background: isPresetSelected(reason) ? '#ebf8ff' : 'white',
                                    color: isPresetSelected(reason) ? '#2c5282' : '#4a5568',
                                    fontWeight: 'bold',
                                    fontSize: '0.88rem',
                                    cursor: 'pointer'
                                }}
                            >
                                {reason}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#4a5568' }}>사유 입력</label>
                    <input
                        type="text"
                        value={customReason}
                        onChange={(e) => onCustomReasonChange(e.target.value)}
                        placeholder="3글자 이하 권장"
                        style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            outline: 'none',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>

                <div style={{ margin: '15px 0', borderTop: '1px solid #e2e8f0' }}></div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <button
                        onClick={() => onReasonSelect('vacation_full')}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: '10px',
                            border: isSelected('vacation_full') ? '2px solid #c53030' : '1px solid #feb2b2',
                            background: '#fff5f5',
                            color: '#c53030', fontWeight: 'bold', fontSize: '0.9rem',
                            cursor: 'pointer'
                        }}
                    >
                        월차
                    </button>
                    <button
                        onClick={() => onReasonSelect('vacation_half_am')}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: '10px',
                            border: isSelected('vacation_half_am') ? '2px solid #c53030' : '1px solid #feb2b2',
                            background: '#fff5f5',
                            color: '#c53030', fontWeight: 'bold', fontSize: '0.9rem',
                            cursor: 'pointer'
                        }}
                    >
                        오전반차
                    </button>
                    <button
                        onClick={() => onReasonSelect('vacation_half_pm')}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: '10px',
                            border: isSelected('vacation_half_pm') ? '2px solid #2c5282' : '1px solid #90cdf4',
                            background: '#ebf8ff',
                            color: '#2c5282', fontWeight: 'bold', fontSize: '0.9rem',
                            cursor: 'pointer'
                        }}
                    >
                        오후반차
                    </button>
                </div>



                <button
                    onClick={onInstantCancel}
                    style={{
                        width: '100%', marginTop: '8px', padding: '10px', borderRadius: '10px',
                        border: '1px solid #cbd5e0',
                        background: '#edf2f7',
                        color: '#4a5568', fontWeight: 'bold', fontSize: '0.9rem',
                        cursor: 'pointer'
                    }}
                >
                    휴가취소
                </button>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button
                        onClick={onSubmit}
                        style={{
                            flex: 1, padding: '12px', borderRadius: '10px',
                            border: 'none', background: '#3182ce', color: 'white',
                            fontWeight: 'bold', fontSize: '0.95rem', cursor: 'pointer'
                        }}
                    >
                        신청
                    </button>
                    <button
                        onClick={onFixedSubmit}
                        style={{
                            flex: 1, padding: '12px', borderRadius: '10px',
                            border: 'none', background: '#805ad5', color: 'white',
                            fontWeight: 'bold', fontSize: '0.95rem', cursor: 'pointer'
                        }}
                    >
                        고정신청
                    </button>
                </div>

                <button
                    onClick={onClose}
                    style={{
                        width: '100%', marginTop: '8px', padding: '12px', borderRadius: '10px',
                        border: 'none', background: '#e2e8f0', color: '#718096',
                        fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer'
                    }}
                >
                    닫기
                </button>
            </div>
        </div >,
        document.body
    );
};

// Memoized Cell with Long Press Support
const AttendanceCell = React.memo(({ user, dateStr, period, isRowHighlighted, isSelected, onSelect, attendanceData, statusData, vacationData, onLongPress, width, scale }) => {
    const key = `${user.id}_${dateStr}_${period}`;
    const isAttended = attendanceData.has(key);
    const status = statusData[key] || null;
    const vac = vacationData[`${user.id}_${dateStr}`];
    const isDeactivated = user.isEmpty || user.isUnassigned;

    const longPressTimer = useRef(null);
    const isLongPress = useRef(false);
    const isDragging = useRef(false);
    const pointerStart = useRef(null);

    let bg = 'white';
    let content = null;
    let color = '#2d3748';

    if (isDeactivated) {
        bg = '#f7fafc';
        color = '#cbd5e0';
    } else if (isRowHighlighted) {
        bg = '#ebf8ff';
    }

    if (vac) {
        if (vac.type === 'full') {
            bg = '#c6f6d5';
            color = '#22543d';
            content = vac.reason ? `월차` : '월차';
        } else if (vac.type === 'half') {
            const isAm = (vac.periods || []).includes(1);
            if (isAm && period <= 4) {
                bg = '#c6f6d5';
                color = '#22543d';
                content = '오전';
            } else if (!isAm && period >= 4) {
                bg = '#c6f6d5';
                color = '#22543d';
                content = '오후';
            }
        } else if (vac.type === 'special') {
            const vacPeriods = Array.isArray(vac.periods) ? vac.periods : [];
            const appliesThisPeriod = vacPeriods.length === 0 || vacPeriods.includes(period);

            if (appliesThisPeriod) {
                bg = '#c6f6d5';
                color = '#c53030';
                content = vac.reason || '특휴';
            }
        }
    }

    // Special status styling (green bg, red text)
    if (isAttended && status) {
        bg = '#c6f6d5';
        color = '#c53030';
        content = status;
    } else if (isAttended) {
        bg = '#c6f6d5';
        color = '#22543d';
        content = 'O';
    } else {
        if (!content && (bg === 'white' || bg === '#ebf8ff' || bg === '#f7fafc')) {
            if (!isDeactivated) {
                bg = '#fed7d7';
                color = '#c53030';
            }
            content = 'X';
        }
    }

    const clearLongPressTimer = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const getPointFromEvent = (e) => {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
            return { x: e.clientX, y: e.clientY };
        }
        return null;
    };

    const handleStart = (e) => {
        if (isDeactivated) return;
        isLongPress.current = false;
        isDragging.current = false;
        pointerStart.current = getPointFromEvent(e);
        clearLongPressTimer();
        longPressTimer.current = setTimeout(() => {
            isLongPress.current = true;
            onLongPress(user, dateStr, period);
        }, 500);
    };

    const handleMove = (e) => {
        if (!pointerStart.current || !longPressTimer.current) return;
        const currentPoint = getPointFromEvent(e);
        if (!currentPoint) return;

        const dx = currentPoint.x - pointerStart.current.x;
        const dy = currentPoint.y - pointerStart.current.y;
        const movedEnough = Math.hypot(dx, dy) > 8;

        if (movedEnough) {
            isDragging.current = true;
            clearLongPressTimer();
        }
    };

    const handleEnd = () => {
        clearLongPressTimer();
        pointerStart.current = null;
    };

    const handleClick = () => {
        if (isDeactivated) return;
        if (!isLongPress.current && !isDragging.current) {
            onSelect(user, dateStr, period);
        }
        isLongPress.current = false;
        isDragging.current = false;
    };

    return (
        <div
            onMouseDown={handleStart}
            onMouseMove={(e) => {
                if (e.buttons === 1) handleMove(e);
            }}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            onTouchCancel={handleEnd}
            onClick={handleClick}
            onContextMenu={(e) => e.preventDefault()}
            style={{
                width: width, flexShrink: 0, height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: bg, color, fontSize: `${0.8 * scale}rem`, fontWeight: 'bold',
                borderRight: '1px solid #e2e8f0',
                whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.1,
                cursor: isDeactivated ? 'default' : 'pointer',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                boxShadow: isSelected ? 'inset 0 0 0 3px #3182ce' : 'none', // Blue highlight for selected
                zIndex: isSelected ? 10 : 'auto'
            }}
        >
            {content}
        </div>
    );
}, (prev, next) => {
    return (
        prev.scale === next.scale &&
        prev.width === next.width &&
        prev.isRowHighlighted === next.isRowHighlighted &&
        prev.isSelected === next.isSelected && // Check isSelected
        prev.attendanceData === next.attendanceData &&
        prev.statusData === next.statusData &&
        prev.vacationData === next.vacationData
    );
});

// Memo Block for Popup (Single Text Area)
const UserMemoPopup = ({ user, memberMemos, onSave, onClose }) => {
    const userMemos = memberMemos.filter(m => m.user_id === user.id);
    // Join existing memos with newlines if there are multiple (migration/fallback)
    const initialText = userMemos.map(m => m.content).join('\n');
    const [text, setText] = useState(initialText);

    const handleSave = () => {
        onSave(user.id, text.trim());
    };

    return (
        <div style={{
            height: '100%', display: 'flex', flexDirection: 'column',
            backgroundColor: 'white', borderTop: '2px solid #e2e8f0',
            boxShadow: '0 -4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
            <div style={{
                padding: '12px 20px', borderBottom: '1px solid #edf2f7',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                backgroundColor: '#f7fafc'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2d3748' }}>
                        {user.name} <span style={{ fontSize: '0.9rem', color: '#718096', fontWeight: 'normal' }}>(좌석 {user.seat_number || '-'})</span>
                    </span>
                    <span style={{ fontSize: '0.9rem', color: '#4a5568', background: '#edf2f7', padding: '2px 8px', borderRadius: '4px' }}>
                        참고사항
                    </span>
                </div>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onClose();
                    }}
                    style={{
                        padding: '8px', borderRadius: '50%', border: 'none', background: 'white',
                        cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    <X size={20} color="#4a5568" />
                </button>
            </div>

            <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', backgroundColor: '#fff' }}>
                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="참고사항을 입력하세요..."
                    style={{
                        flex: 1,
                        width: '100%',
                        resize: 'none',
                        border: '1px solid #cbd5e0',
                        borderRadius: '8px',
                        padding: '12px',
                        fontSize: '1rem',
                        lineHeight: '1.5',
                        outline: 'none',
                        fontFamily: 'inherit'
                    }}
                />
            </div>

            <div style={{ padding: '15px 20px', borderTop: '1px solid #edf2f7', backgroundColor: 'white', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={handleSave}
                    style={{
                        background: '#3182ce', color: 'white', border: 'none', borderRadius: '8px',
                        padding: '10px 24px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                >
                    <Save size={18} /> 저장
                </button>
            </div>
        </div>
    );
};

// Redesigned Incoming Employee Modal - Fetches from pending_registrations and syncs todos
const IncomingEmployeeModal = ({ onClose }) => {
    const [pendingEmployees, setPendingEmployees] = useState([]);
    const [todos, setTodos] = useState({});
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});

    useEffect(() => {
        fetchPendingEmployees();

        // Subscribe to real-time updates for staff_todos
        const todosSubscription = supabase
            .channel('staff_todos_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'staff_todos',
                filter: 'pending_registration_id=not.is.null'
            }, () => {
                fetchPendingEmployees();
            })
            .subscribe();

        return () => {
            todosSubscription.unsubscribe();
        };
    }, []);

    const fetchPendingEmployees = async () => {
        setLoading(true);
        try {
            // Fetch pending_registrations
            const { data: pending, error: pendingError } = await supabase
                .from('pending_registrations')
                .select('*')
                .order('expected_start_date', { ascending: true });

            if (pendingError) throw pendingError;

            // Fetch all related todos
            const { data: allTodos, error: todosError } = await supabase
                .from('staff_todos')
                .select('*')
                .not('pending_registration_id', 'is', null);

            if (todosError) throw todosError;

            // Group todos by pending_registration_id
            const todosByPending = {};
            (allTodos || []).forEach(todo => {
                if (!todosByPending[todo.pending_registration_id]) {
                    todosByPending[todo.pending_registration_id] = [];
                }
                todosByPending[todo.pending_registration_id].push(todo);
            });

            setPendingEmployees(pending || []);
            setTodos(todosByPending);
        } catch (error) {
            console.error('Error fetching pending employees:', error);
        } finally {
            setLoading(false);
        }
    };

    const toggleTodo = async (todoId, currentStatus) => {
        try {
            const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
            const { data: { user } } = await supabase.auth.getUser();

            const { error } = await supabase
                .from('staff_todos')
                .update({
                    status: newStatus,
                    completed_by: newStatus === 'completed' ? user?.id : null,
                    completed_at: newStatus === 'completed' ? new Date().toISOString() : null
                })
                .eq('id', todoId);

            if (error) throw error;
            await fetchPendingEmployees();
        } catch (error) {
            console.error('Error toggling todo:', error);
            alert('투두 업데이트 실패');
        }
    };

    const startEdit = (employee) => {
        setEditingId(employee.id);
        setEditForm({
            name: employee.name,
            seat_number: employee.seat_number || '',
            expected_start_date: employee.expected_start_date || '',
            target_certificate: employee.target_certificate || ''
        });
    };

    const saveEdit = async (id) => {
        try {
            const { error } = await supabase
                .from('pending_registrations')
                .update({
                    name: editForm.name,
                    seat_number: editForm.seat_number || null,
                    expected_start_date: editForm.expected_start_date || null,
                    target_certificate: editForm.target_certificate || null
                })
                .eq('id', id);

            if (error) throw error;

            // Update todos
            const employeeTodos = todos[id] || [];
            const dateObj = editForm.expected_start_date ? new Date(editForm.expected_start_date) : new Date();
            const month = dateObj.getMonth() + 1;
            const date = dateObj.getDate();
            const shortDate = `${month}/${date}`;
            const todoPrefix = `${shortDate} ${editForm.seat_number ? `${editForm.seat_number}번` : ''} ${editForm.name}${editForm.target_certificate ? ` ${editForm.target_certificate}` : ''}`;

            const tasks = ['명패 준비', '책상 정비', '좌석 및 음료 정보 입력 확인', '이름스티커 준비'];
            for (let i = 0; i < employeeTodos.length; i++) {
                await supabase
                    .from('staff_todos')
                    .update({ content: `${todoPrefix} ${tasks[i] || ''}` })
                    .eq('id', employeeTodos[i].id);
            }

            setEditingId(null);
            setEditForm({});
            await fetchPendingEmployees();
        } catch (error) {
            console.error('Error saving edit:', error);
            alert('수정 실패');
        }
    };

    const deletePending = async (id) => {
        if (!confirm('삭제하시겠습니까?')) return;
        try {
            const { error } = await supabase
                .from('pending_registrations')
                .delete()
                .eq('id', id);

            if (error) throw error;
            await fetchPendingEmployees();
        } catch (error) {
            console.error('Error deleting:', error);
            alert('삭제 실패');
        }
    };

    return createPortal(
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: 'white', borderRadius: '16px', width: '90%', maxWidth: '600px',
                height: '85vh', display: 'flex', flexDirection: 'column',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }}>
                <div style={{ padding: '20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#267E82', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <UserPlus size={24} /> 입사예정자 관리
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} color="#a0aec0" /></button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '40px' }}>로딩중...</div>
                    ) : pendingEmployees.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '40px' }}>
                            입사예정자가 없습니다.<br />
                            <span style={{ fontSize: '0.85rem' }}>관리자 페이지에서 사원 등록 시 자동으로 추가됩니다.</span>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {pendingEmployees.map(emp => {
                                const employeeTodos = todos[emp.id] || [];
                                const allComplete = employeeTodos.length === 3 && employeeTodos.every(t => t.status === 'completed');
                                const isEditing = editingId === emp.id;

                                return (
                                    <div key={emp.id} style={{
                                        background: allComplete ? '#f0fff4' : 'white',
                                        border: `2px solid ${allComplete ? '#38a169' : '#e2e8f0'}`,
                                        borderRadius: '12px',
                                        padding: '15px',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                    }}>
                                        {isEditing ? (
                                            // Edit Mode
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>수정</span>
                                                    <div style={{ display: 'flex', gap: '5px' }}>
                                                        <button onClick={() => saveEdit(emp.id)} style={{ padding: '6px 10px', background: '#38a169', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>저장</button>
                                                        <button onClick={() => { setEditingId(null); setEditForm({}); }} style={{ padding: '6px 10px', background: '#e2e8f0', color: '#4a5568', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>취소</button>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', color: '#718096', display: 'block', marginBottom: '3px' }}>이름</label>
                                                        <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e0', fontSize: '0.9rem' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', color: '#718096', display: 'block', marginBottom: '3px' }}>좌석</label>
                                                        <input type="number" value={editForm.seat_number} onChange={(e) => setEditForm({ ...editForm, seat_number: e.target.value })} style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e0', fontSize: '0.9rem' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', color: '#718096', display: 'block', marginBottom: '3px' }}>입사예정일</label>
                                                        <input type="date" value={editForm.expected_start_date} onChange={(e) => setEditForm({ ...editForm, expected_start_date: e.target.value })} style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e0', fontSize: '0.9rem' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', color: '#718096', display: 'block', marginBottom: '3px' }}>자격증</label>
                                                        <input value={editForm.target_certificate} onChange={(e) => setEditForm({ ...editForm, target_certificate: e.target.value })} style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e0', fontSize: '0.9rem' }} />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            // View Mode
                                            <>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                                    <div>
                                                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2d3748' }}>
                                                            {emp.seat_number ? `${emp.seat_number}번` : ''} {emp.name} {emp.target_certificate && <span style={{ fontSize: '0.9rem', color: '#2b6cb0' }}>{emp.target_certificate}</span>}
                                                        </div>
                                                        {emp.expected_start_date && (
                                                            <div style={{ fontSize: '0.85rem', color: '#718096', marginTop: '2px' }}>
                                                                입사예정: {format(new Date(emp.expected_start_date), 'M월 d일(EEE)', { locale: ko })}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '5px' }}>
                                                        <button onClick={() => startEdit(emp)} style={{ padding: '6px', background: '#ebf8ff', color: '#3182ce', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                                                            <Save size={16} />
                                                        </button>
                                                        <button onClick={() => deletePending(emp.id)} style={{ padding: '6px', background: '#fff5f5', color: '#e53e3e', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                                                            <Trash size={16} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Todos */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                                                    {employeeTodos.length === 0 ? (
                                                        <div style={{ fontSize: '0.85rem', color: '#a0aec0', textAlign: 'center', padding: '10px' }}>투두가 생성되지 않았습니다</div>
                                                    ) : (
                                                        employeeTodos.map((todo) => {
                                                            // Extract task name from todo content
                                                            // Content format: "M/d 좌석번 이름 자격증 작업명"
                                                            let taskName = '작업';
                                                            if (todo.content.includes('명패 준비')) {
                                                                taskName = '명패 준비';
                                                            } else if (todo.content.includes('책상 정비')) {
                                                                taskName = '책상 정비';
                                                            } else if (todo.content.includes('좌석 및 음료 정보 입력 확인')) {
                                                                taskName = '좌석 및 음료 정보 입력 확인';
                                                            } else if (todo.content.includes('이름스티커 준비')) {
                                                                taskName = '이름스티커 준비';
                                                            }

                                                            const isComplete = todo.status === 'completed';

                                                            return (
                                                                <div key={todo.id} style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '10px',
                                                                    padding: '8px',
                                                                    background: isComplete ? '#f0fff4' : '#f7fafc',
                                                                    borderRadius: '8px',
                                                                    border: `1px solid ${isComplete ? '#9ae6b4' : '#e2e8f0'}`
                                                                }}>
                                                                    <div
                                                                        onClick={() => toggleTodo(todo.id, todo.status)}
                                                                        style={{ cursor: 'pointer', color: isComplete ? '#38a169' : '#cbd5e0' }}
                                                                    >
                                                                        {isComplete ? <CheckSquare size={20} /> : <Square size={20} />}
                                                                    </div>
                                                                    <div style={{
                                                                        flex: 1,
                                                                        fontSize: '0.9rem',
                                                                        color: isComplete ? '#718096' : '#2d3748',
                                                                        textDecoration: isComplete ? 'line-through' : 'none'
                                                                    }}>
                                                                        {taskName}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};


const StaffDailyAttendance = ({ onBack }) => {
    const [today] = useState(new Date());
    // Fixed: Initialize navigation with today, allow changes
    const [currentViewDate, setCurrentViewDate] = useState(new Date());
    const [scale, setScale] = useState(1.0);
    const [branch, setBranch] = useState('망미점');

    const [displayRows, setDisplayRows] = useState([]);
    const [attendanceData, setAttendanceData] = useState(new Set());
    const [statusData, setStatusData] = useState({}); // {key: status}
    const [attendanceLogIdData, setAttendanceLogIdData] = useState({}); // {key: attendance_logs.id}
    const [vacationData, setVacationData] = useState({});
    const [dailyMemos, setDailyMemos] = useState([]);
    const [memberMemos, setMemberMemos] = useState([]);
    const [memberSuggestions, setMemberSuggestions] = useState([]);
    const [staffTodoCount, setStaffTodoCount] = useState(0);
    const [sideDishRequests, setSideDishRequests] = useState([]);
    const [incomingEmployees, setIncomingEmployees] = useState([]);
    const [pendingTodos, setPendingTodos] = useState({}); // {pending_registration_id: [todos]}

    const [loading, setLoading] = useState(false);
    const [highlightedUserId, setHighlightedUserId] = useState(null);
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [showMemoModal, setShowMemoModal] = useState(false);
    const [showSuggestionModal, setShowSuggestionModal] = useState(false);
    const [showTodoModal, setShowTodoModal] = useState(false);
    const [showSideDishModal, setShowSideDishModal] = useState(false);
    const [showIncomingModal, setShowIncomingModal] = useState(false);
    const [newMemo, setNewMemo] = useState('');
    const [editingMemoId, setEditingMemoId] = useState(null);
    const [editingMemoText, setEditingMemoText] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [nowTick, setNowTick] = useState(Date.now());

    // Status popup state
    const createClosedPopupState = () => {
        const todayDateStr = getKstNowParts().dateStr;
        return {
            open: false,
            user: null,
            dateStr: '',
            period: null,
            selectedDates: [todayDateStr],
            calendarMonth: createDateFromYmd(todayDateStr),
            selectedPeriods: [],
            selectedReason: null,
            selectedPresetReason: null,
            customReason: ''
        };
    };
    const [statusPopup, setStatusPopup] = useState(createClosedPopupState());
    const [selectedCell, setSelectedCell] = useState(null); // { userId, dateStr, period }

    const scrollContainerRef = useRef(null);
    const contentRef = useRef(null);
    const rowRefs = useRef({}); // Refs for scrolling to rows
    const [touchStartDist, setTouchStartDist] = useState(null);
    const [startScale, setStartScale] = useState(1.0);

    // Dynamic Constants
    const BASE_SEAT_WIDTH = 50;
    const BASE_NAME_WIDTH = 80;
    const BASE_PERIOD_WIDTH = 45;
    const BASE_ROW_HEIGHT = 40;
    const BASE_HEADER_DATE_HEIGHT = 40;
    const BASE_HEADER_PERIOD_HEIGHT = 35;

    const SEAT_WIDTH = BASE_SEAT_WIDTH * scale;
    const NAME_WIDTH = BASE_NAME_WIDTH * scale;
    const PERIOD_WIDTH = BASE_PERIOD_WIDTH * scale;
    const ROW_HEIGHT = BASE_ROW_HEIGHT * scale;
    const HEADER_DATE_HEIGHT = BASE_HEADER_DATE_HEIGHT * scale;
    const HEADER_PERIOD_HEIGHT = BASE_HEADER_PERIOD_HEIGHT * scale;
    const HEADER_TOTAL_HEIGHT = HEADER_DATE_HEIGHT + HEADER_PERIOD_HEIGHT;

    const DAY_WIDTH = PERIOD_WIDTH * 7;

    const daysInView = useMemo(() => [currentViewDate], [currentViewDate]);
    const currentDateStr = useMemo(() => format(currentViewDate, 'yyyy-MM-dd'), [currentViewDate]);
    const kstNow = useMemo(() => getKstNowParts(nowTick), [nowTick]);
    const shouldShowIncomingForDate = (dateStr) => {
        if (!dateStr) return false;
        if (dateStr > kstNow.dateStr) return true;
        if (dateStr < kstNow.dateStr) return false;
        if (kstNow.hour < 8) return true;
        if (kstNow.hour === 8 && kstNow.minute < 59) return true;
        return false;
    };
    const incomingBySeat = useMemo(() => {
        const grouped = {};
        (incomingEmployees || [])
            .filter((emp) => emp.expected_start_date === currentDateStr && emp.seat_number)
            .forEach((emp) => {
                const seat = Number(emp.seat_number);
                if (!grouped[seat]) grouped[seat] = [];
                grouped[seat].push(emp);
            });
        return grouped;
    }, [incomingEmployees, currentDateStr]);

    // Row Reordering REMOVED - just use displayRows
    const sortedRows = displayRows;

    // Auto Scroll to Highlighted Row
    useEffect(() => {
        if (highlightedUserId && rowRefs.current[highlightedUserId]) {
            const rowEl = rowRefs.current[highlightedUserId];
            if (rowEl && scrollContainerRef.current) {
                // Scroll to top (under header)
                const container = scrollContainerRef.current;
                const targetScrollTop = rowEl.offsetTop - HEADER_TOTAL_HEIGHT;

                container.scrollTo({
                    top: targetScrollTop,
                    behavior: 'smooth'
                });
            }
        }
    }, [highlightedUserId, HEADER_TOTAL_HEIGHT]);

    useEffect(() => {
        const timer = setInterval(() => setNowTick(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    const selectedUser = useMemo(() => {
        return displayRows.find(r => r.id === highlightedUserId);
    }, [displayRows, highlightedUserId]);

    const sortedMemberSuggestions = useMemo(() => {
        return [...memberSuggestions]
            .filter((suggestion) => {
                if (branch === '전체') return true;
                return suggestion.branch === branch;
            })
            .filter((suggestion) => {
                if (suggestion.status !== 'completed') return true;
                const completedDate = toKstDateStrFromIso(suggestion.resolved_at);
                return completedDate === kstNow.dateStr;
            })
            .sort((a, b) => {
                if (a.status !== b.status) {
                    return a.status === 'pending' ? -1 : 1;
                }
                return new Date(a.created_at) - new Date(b.created_at);
            });
    }, [memberSuggestions, branch, kstNow.dateStr]);

    const pendingSuggestionCount = useMemo(() => {
        return sortedMemberSuggestions.filter((suggestion) => suggestion.status === 'pending').length;
    }, [sortedMemberSuggestions]);

    const sideDishSummary = useMemo(() => {
        const sortBySubmitted = (a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0);
        const toRows = (period) => sideDishRequests
            .filter((request) => request.period === period)
            .sort(sortBySubmitted)
            .flatMap((request) => request.items.map((item) => ({
                dishName: item.name,
                amount: item.amount,
                requesterName: request.requesterName,
                seatNumber: request.seatNumber
            })));
        const am = toRows('am');
        const pm = toRows('pm');

        return {
            am,
            pm,
            totalCount: am.length + pm.length,
            hasAny: am.length + pm.length > 0
        };
    }, [sideDishRequests]);

    const formatWon = (amount) => `${Number(amount || 0).toLocaleString('ko-KR')}원`;

    const renderSideDishPeriodList = (title, list) => (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', background: '#f8fafc' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: '800', color: '#1f2937', marginBottom: '8px' }}>
                {title}
            </div>
            {list.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>신청 없음</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {list.map((item, index) => (
                        <div key={`${title}-${index}-${item.requesterName}-${item.dishName}`} style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.35 }}>
                            {index + 1}. {item.dishName} {formatWon(item.amount)} {item.seatNumber ? `${item.seatNumber}번 ` : ''}{item.requesterName}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const getQuickButtonStyle = (enabled, tone = 'green') => {
        const active = tone === 'blue'
            ? { bg: '#ebf8ff', border: '#bee3f8', color: '#2b6cb0' }
            : { bg: '#f0fff4', border: '#9ae6b4', color: '#2f855a' };

        return {
            minWidth: 0,
            height: '32px',
            padding: '0 6px',
            borderRadius: '10px',
            border: `1px solid ${enabled ? active.border : '#cbd5e0'}`,
            background: enabled ? active.bg : '#edf2f7',
            color: enabled ? active.color : '#94a3b8',
            fontSize: 'clamp(0.62rem, 2.35vw, 0.78rem)',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3px',
            cursor: enabled ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            boxSizing: 'border-box'
        };
    };

    const CountBadge = ({ count }) => (
        <span style={{
            color: '#2f855a',
            background: 'white',
            minWidth: '17px',
            height: '17px',
            padding: '0 4px',
            borderRadius: '999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.68rem',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            flexShrink: 0,
            boxSizing: 'border-box'
        }}>
            {count}
        </span>
    );

    const formatSuggestionReplyTime = (createdAt) => {
        if (!createdAt) return '';
        const date = new Date(createdAt);
        return date.toLocaleString('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Fetch on Date Change
    useEffect(() => {
        fetchData();

        // Real-time subscriptions for attendance data
        const attendanceChannel = supabase
            .channel('attendance_logs_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'attendance_logs'
            }, () => {
                fetchData();
            })
            .subscribe();

        const vacationChannel = supabase
            .channel('vacation_requests_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'vacation_requests'
            }, () => {
                fetchData();
            })
            .subscribe();

        const memosChannel = supabase
            .channel('attendance_memos_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'attendance_memos'
            }, () => {
                fetchData();
            })
            .subscribe();

        const pendingChannel = supabase
            .channel('pending_attendance_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'pending_registrations'
            }, () => {
                fetchData();
            })
            .subscribe();

        const pendingTodoChannel = supabase
            .channel('pending_todo_attendance_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'staff_todos',
                filter: 'pending_registration_id=not.is.null'
            }, () => {
                fetchData();
            })
            .subscribe();

        const staffTodoChannel = supabase
            .channel('staff_todo_attendance_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'staff_todos'
            }, () => {
                fetchData();
            })
            .subscribe();

        const sideDishChannel = supabase
            .channel('side_dish_attendance_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'side_dish_requests'
            }, () => {
                fetchData();
            })
            .subscribe();

        const suggestionsChannel = supabase
            .channel('suggestions_attendance_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'suggestions'
            }, () => {
                fetchData();
            })
            .subscribe();

        const newBeverageChannel = supabase
            .channel('new_beverage_attendance_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'new_beverage_requests'
            }, () => {
                fetchData();
            })
            .subscribe();

        return () => {
            attendanceChannel.unsubscribe();
            vacationChannel.unsubscribe();
            memosChannel.unsubscribe();
            pendingChannel.unsubscribe();
            pendingTodoChannel.unsubscribe();
            staffTodoChannel.unsubscribe();
            sideDishChannel.unsubscribe();
            suggestionsChannel.unsubscribe();
            newBeverageChannel.unsubscribe();
        };
    }, [currentViewDate, branch]);

    // Auto-fit Logic: Always Active
    const fitScale = () => {
        if (scrollContainerRef.current) {
            const containerWidth = scrollContainerRef.current.clientWidth;
            // Width of fixed headers + width of day data
            const contentRequiredWidth = BASE_SEAT_WIDTH + BASE_NAME_WIDTH + (BASE_PERIOD_WIDTH * 7);
            const newScale = containerWidth / contentRequiredWidth;
            // Allow scale to exactly fit, bounded reasonably
            setScale(Math.max(newScale, 0.5));
        }
    };

    // Initial Fit & Resize Listener
    useEffect(() => {
        fitScale();
        window.addEventListener('resize', fitScale);
        return () => window.removeEventListener('resize', fitScale);
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch ONLY current view date
            const dateStr = format(currentViewDate, 'yyyy-MM-dd');
            // Use same date for start/end to fetch only one day
            const startDate = dateStr;
            const endDate = dateStr;

            const [userRes, logRes, vacRes, dailyMemoRes, memberMemoRes, pendingRes, todosRes, suggestionsRes, newBeverageReqRes, staffTaskRes, sideDishRes] = await Promise.all([
                supabase.from('profiles').select('*').eq('branch', branch).order('seat_number', { ascending: true, nullsLast: true }),
                supabase.from('attendance_logs').select('id, user_id, date, period, status').gte('date', startDate).lte('date', endDate),
                supabase.from('vacation_requests').select('*').gte('date', startDate).lte('date', endDate),
                supabase.from('attendance_memos').select('*').eq('date', dateStr).order('created_at', { ascending: true }),
                supabase.from('member_memos').select('*').order('created_at', { ascending: true }),
                supabase.from('pending_registrations').select('*').eq('branch', branch).order('expected_start_date', { ascending: true }),
                supabase.from('staff_todos').select('id, pending_registration_id, status').eq('branch', branch).not('pending_registration_id', 'is', null),
                supabase.from('suggestions').select(`
                    id,
                    content,
                    status,
                    created_at,
                    resolved_at,
                    author:user_id ( name, branch ),
                    completer:completed_by ( name )
                `),
                supabase.from('new_beverage_requests').select(`
                    user_id,
                    beverage_1_choice,
                    beverage_2_choice,
                    beverage_2_custom,
                    use_personal_tumbler,
                    created_at,
                    updated_at,
                    requester:user_id ( name, seat_number, branch )
                `),
                supabase.from('staff_todos').select('id, content, status, branch, pending_registration_id, completed_at, created_at').eq('branch', branch),
                supabase.from('side_dish_requests').select(`
                    id,
                    period,
                    items,
                    total_amount,
                    payment_completed,
                    submitted_at,
                    requester:user_id ( name, branch, seat_number )
                `).eq('request_date', dateStr).order('submitted_at', { ascending: true })
            ]);

            if (userRes.error) throw userRes.error;
            if (logRes.error) throw logRes.error;  // etc...
            if (pendingRes.error) throw pendingRes.error;
            if (todosRes.error) throw todosRes.error;
            if (suggestionsRes.error) throw suggestionsRes.error;
            if (staffTaskRes.error) {
                console.warn('Staff task count unavailable:', staffTaskRes.error);
            }
            if (sideDishRes.error) {
                console.warn('Side dish requests unavailable:', sideDishRes.error);
            }
            if (newBeverageReqRes.error) {
                console.warn('New beverage request feed unavailable:', newBeverageReqRes.error);
            }

            const MAX_SEATS = 102;
            const fullRows = [];
            const userMap = {};
            const unassignedUsers = [];
            (userRes.data || []).forEach(u => {
                if (u.seat_number) userMap[u.seat_number] = u;
                else unassignedUsers.push(u);
            });
            for (let i = 1; i <= MAX_SEATS; i++) {
                if (userMap[i]) fullRows.push(userMap[i]);
                else fullRows.push({ id: `empty_${i}`, seat_number: i, name: '공석', isEmpty: true });
            }
            unassignedUsers.forEach(u => fullRows.push({ ...u, isUnassigned: true, seat_number: null }));
            setDisplayRows(fullRows);

            const attSet = new Set();
            const statusMap = {};
            const attendanceLogIdMap = {};
            (logRes.data || []).forEach(l => {
                const key = `${l.user_id}_${l.date}_${l.period}`;
                attSet.add(key);
                attendanceLogIdMap[key] = l.id;
                if (l.status) statusMap[key] = l.status;
            });
            setAttendanceData(attSet);
            setStatusData(statusMap);
            setAttendanceLogIdData(attendanceLogIdMap);

            const vacMap = {};
            (vacRes.data || []).forEach((v) => {
                const key = `${v.user_id}_${v.date}`;
                const existing = vacMap[key];
                const isRegularVacation = v.type === 'full' || v.type === 'half';

                if (!existing && isRegularVacation) {
                    vacMap[key] = v;
                    return;
                }

                if (!existing && !isRegularVacation) {
                    vacMap[key] = v;
                    return;
                }

                if (existing && (existing.type !== 'full' && existing.type !== 'half') && isRegularVacation) {
                    vacMap[key] = v;
                }
            });
            setVacationData(vacMap);

            const todosByPending = {};
            (todosRes.data || []).forEach((todo) => {
                if (!todo.pending_registration_id) return;
                if (!todosByPending[todo.pending_registration_id]) {
                    todosByPending[todo.pending_registration_id] = [];
                }
                todosByPending[todo.pending_registration_id].push(todo);
            });
            setPendingTodos(todosByPending);

            const staffTodoRows = staffTaskRes.error ? [] : (staffTaskRes.data || []);
            const dismissMarkers = new Set(
                staffTodoRows
                    .filter((todo) => !todo.pending_registration_id && typeof todo.content === 'string' && todo.content.startsWith('__NEW_HIRE_NOTICE_DISMISSED__:'))
                    .map((todo) => todo.content.replace('__NEW_HIRE_NOTICE_DISMISSED__:', '').trim())
            );
            const manualPendingCount = staffTodoRows.filter((todo) => (
                !todo.pending_registration_id
                && !(typeof todo.content === 'string' && todo.content.startsWith('__NEW_HIRE_NOTICE_DISMISSED__:'))
                && todo.status !== 'completed'
            )).length;
            const groupedNewHireKeys = new Map();
            (pendingRes.data || []).forEach((emp) => {
                if (!emp.expected_start_date) return;
                const key = `${emp.branch || ''}_${emp.expected_start_date}`;
                if (!groupedNewHireKeys.has(key)) groupedNewHireKeys.set(key, []);
                groupedNewHireKeys.get(key).push(emp.id);
            });
            const newHirePendingCount = Array.from(groupedNewHireKeys.entries()).filter(([key, pendingIds]) => {
                if (dismissMarkers.has(key)) return false;
                const related = staffTodoRows.filter((todo) => pendingIds.includes(todo.pending_registration_id));
                return related.length === 0 || related.some((todo) => todo.status !== 'completed');
            }).length;
            setStaffTodoCount(manualPendingCount + newHirePendingCount);

            const normalizedSideDish = sideDishRes.error ? [] : (sideDishRes.data || [])
                .filter((row) => row.payment_completed && row.submitted_at)
                .filter((row) => !row.requester?.branch || row.requester.branch === branch)
                .map((row) => {
                    const batches = normalizeSideDishBatches(row.items, row.submitted_at);
                    const items = batches.flatMap((batch) => batch.items);
                    const calculatedTotal = items.reduce((sum, item) => sum + item.amount, 0);

                    return {
                        id: row.id,
                        period: row.period,
                        items,
                        totalAmount: row.total_amount || calculatedTotal,
                        requesterName: row.requester?.name || '',
                        seatNumber: row.requester?.seat_number || null,
                        submittedAt: row.submitted_at
                    };
                });
            setSideDishRequests(normalizedSideDish);

            const enrichedIncomingEmployees = (pendingRes.data || []).map((emp) => {
                const relatedTodos = todosByPending[emp.id] || [];
                const isChecked = relatedTodos.length > 0 && relatedTodos.every((todo) => todo.status === 'completed');
                return {
                    ...emp,
                    isChecked,
                    plaqueText: emp.target_certificate || emp.name,
                    beverageText: emp.beverage_drinks || '-'
                };
            });
            setIncomingEmployees(enrichedIncomingEmployees);

            const systemIncomingMemos = enrichedIncomingEmployees
                .filter((emp) => emp.expected_start_date === dateStr)
                .map((emp) => {
                    const seatText = emp.seat_number ? `${emp.seat_number}번 ` : '';

                    return {
                        id: `incoming_${emp.id}_${dateStr}`,
                        content: `신규 ${seatText}${emp.name}(${emp.plaqueText}) ${emp.beverageText}`.trim(),
                        isSystemIncoming: true
                    };
                });

            const systemBeverageMemos = (newBeverageReqRes.data || [])
                .filter((row) => {
                    if (row.requester?.branch && row.requester.branch !== branch) return false;
                    const createdDate = toKstDateStrFromIso(row.created_at);
                    const updatedDate = toKstDateStrFromIso(row.updated_at);
                    const createdDisplayDate = shiftYmdByDays(createdDate, 1);
                    const updatedDisplayDate = shiftYmdByDays(updatedDate, 1);
                    return createdDisplayDate === dateStr || updatedDisplayDate === dateStr;
                })
                .map((row) => {
                    const createdDate = toKstDateStrFromIso(row.created_at);
                    const updatedDate = toKstDateStrFromIso(row.updated_at);
                    const createdDisplayDate = shiftYmdByDays(createdDate, 1);
                    const updatedDisplayDate = shiftYmdByDays(updatedDate, 1);
                    const createdAtMs = row.created_at ? new Date(row.created_at).getTime() : 0;
                    const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                    const isChangedToday = updatedDisplayDate === dateStr && (createdDisplayDate !== dateStr || Math.abs(updatedAtMs - createdAtMs) > 1000);
                    const actionText = isChangedToday ? '변경' : '새로 신청';

                    const seatText = row.requester?.seat_number ? `${row.requester.seat_number}번 ` : '';
                    const nameText = row.requester?.name || '회원';
                    const beverage2Text = formatNewBeverage2Text(row);
                    const eventTime = updatedAtMs || createdAtMs || 0;

                    return {
                        id: `beverage_${row.user_id}_${eventTime}`,
                        content: `${seatText}${nameText} 음료 ${actionText} (${row.beverage_1_choice}, ${beverage2Text})`,
                        isSystemIncoming: true,
                        created_at: row.updated_at || row.created_at
                    };
                })
                .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

            setDailyMemos([...systemIncomingMemos, ...systemBeverageMemos, ...(dailyMemoRes.data || [])]);
            setMemberMemos(memberMemoRes.data || []);

            const formattedSuggestions = (suggestionsRes.data || []).map((suggestion) => {
                const { body, replies } = parseContentWithReplies(suggestion.content);
                return {
                    id: suggestion.id,
                    content: body,
                    replies,
                    status: suggestion.status === 'resolved' ? 'completed' : 'pending',
                    created_at: suggestion.created_at,
                    resolved_at: suggestion.resolved_at,
                    authorName: suggestion.author?.name || '익명',
                    branch: suggestion.author?.branch || '알수없음',
                    completerName: suggestion.completer?.name || null
                };
            });
            setMemberSuggestions(formattedSuggestions);

        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    const toggleAttendance = async (user, dateStr, period) => {
        if (user.isEmpty) return;
        const key = `${user.id}_${dateStr}_${period}`;
        const isAttended = attendanceData.has(key);
        setAttendanceData(prev => {
            const next = new Set(prev);
            if (isAttended) next.delete(key);
            else next.add(key);
            return next;
        });
        // Clear status when toggling
        setStatusData(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        try {
            if (isAttended) await supabase.from('attendance_logs').delete().eq('user_id', user.id).eq('date', dateStr).eq('period', period);
            else await supabase.from('attendance_logs').insert({ user_id: user.id, date: dateStr, period: period });
        } catch (e) { fetchData(); }
    };

    const openStatusPopup = (user, dateStr, period) => {
        const todayDateStr = getKstNowParts().dateStr;
        const initialDateStr = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : todayDateStr;
        setStatusPopup({
            open: true,
            user,
            dateStr: initialDateStr,
            period,
            selectedDates: [initialDateStr],
            calendarMonth: createDateFromYmd(initialDateStr),
            selectedPeriods: period ? [period] : [],
            selectedReason: null,
            selectedPresetReason: null,
            customReason: ''
        });
    };

    const closeStatusPopup = () => {
        setStatusPopup(createClosedPopupState());
    };

    const toggleStatusPopupPeriod = (targetPeriod) => {
        setStatusPopup(prev => {
            if (targetPeriod === 'all') {
                const all = [1, 2, 3, 4, 5, 6, 7];
                const nextPeriods = prev.selectedPeriods.length === 7 ? [] : all;
                return { ...prev, selectedPeriods: nextPeriods };
            }

            const hasPeriod = prev.selectedPeriods.includes(targetPeriod);
            const nextPeriods = hasPeriod
                ? prev.selectedPeriods.filter(p => p !== targetPeriod)
                : [...prev.selectedPeriods, targetPeriod].sort((a, b) => a - b);

            return { ...prev, selectedPeriods: nextPeriods };
        });
    };

    const toggleStatusPopupDate = (targetDateStr) => {
        setStatusPopup(prev => {
            const alreadySelected = prev.selectedDates.includes(targetDateStr);
            const nextDates = alreadySelected
                ? prev.selectedDates.filter((d) => d !== targetDateStr)
                : [...prev.selectedDates, targetDateStr].sort();

            return { ...prev, selectedDates: nextDates };
        });
    };

    const handleStatusPopupMonthChange = (monthDate) => {
        setStatusPopup(prev => ({ ...prev, calendarMonth: monthDate }));
    };

    const handlePopupReasonSelect = (reason) => {
        setStatusPopup(prev => ({ ...prev, selectedReason: reason, selectedPresetReason: null }));
    };

    const handlePopupPresetReasonSelect = (reason) => {
        setStatusPopup(prev => ({
            ...prev,
            selectedReason: null,
            selectedPresetReason: reason,
            customReason: reason
        }));
    };

    const handlePopupCustomReasonChange = (value) => {
        const trimmed = value.trim();
        setStatusPopup(prev => ({
            ...prev,
            customReason: value,
            selectedReason: null,
            selectedPresetReason: POPUP_PRESET_REASONS.includes(trimmed) ? trimmed : null
        }));
    };

    const handlePopupInstantCancel = async () => {
        const { user, dateStr, period, selectedDates } = statusPopup;
        if (!user) return;

        const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : selectedDates[0];
        const targetKey = targetDate && period ? `${user.id}_${targetDate}_${period}` : null;
        const currentStatus = targetKey ? statusData[targetKey] : null;

        if (targetKey && period && currentStatus) {
            const message = `${user.name}의 ${formatYmdToKorean(targetDate)} ${period}교시 '${currentStatus}' 기타휴무를 취소하시겠습니까?`;
            if (!confirm(message)) return;

            try {
                const targetLogId = attendanceLogIdData[targetKey];
                let deleteQuery = supabase.from('attendance_logs').delete();

                if (targetLogId) {
                    deleteQuery = deleteQuery.eq('id', targetLogId);
                } else {
                    deleteQuery = deleteQuery
                        .eq('user_id', user.id)
                        .eq('date', targetDate)
                        .eq('period', period)
                        .eq('status', currentStatus);
                }

                const { error } = await deleteQuery;
                if (error) throw error;

                setAttendanceData(prev => {
                    const next = new Set(prev);
                    next.delete(targetKey);
                    return next;
                });
                setStatusData(prev => {
                    const next = { ...prev };
                    delete next[targetKey];
                    return next;
                });
                setAttendanceLogIdData(prev => {
                    const next = { ...prev };
                    delete next[targetKey];
                    return next;
                });

                closeStatusPopup();
                autoAdvanceSelection(user.id);
                fetchData();
            } catch (e) {
                console.error(e);
                alert(`기타휴무 취소에 실패했습니다: ${e.message}`);
                fetchData();
            }
            return;
        }

        const targetDates = Array.from(new Set(selectedDates)).sort();
        if (targetDates.length === 0) {
            alert('취소할 날짜를 선택해주세요.');
            return;
        }

        if (!confirm(`${user.name}님의 휴가를 취소하시겠습니까?\n날짜: ${targetDates.join(', ')}`)) return;

        try {
            const { count, error } = await supabase
                .from('vacation_requests')
                .delete({ count: 'exact' })
                .eq('user_id', user.id)
                .in('date', targetDates)
                .in('type', ['full', 'half']);

            if (error) throw error;
            if (!count) {
                alert('삭제된 휴가가 없습니다. 이미 삭제되었거나 권한이 없을 수 있습니다.');
                return;
            }

            setVacationData(prev => {
                const next = { ...prev };
                targetDates.forEach((targetDate) => {
                    delete next[`${user.id}_${targetDate}`];
                });
                return next;
            });

            closeStatusPopup();
            autoAdvanceSelection(user.id);
            fetchData();
        } catch (e) {
            console.error('Error canceling vacation:', e);
            alert(`휴가 취소에 실패했습니다: ${e.message}`);
            fetchData();
        }
    };

    const getValidatedPopupReason = () => {
        const { customReason } = statusPopup;
        const trimmed = customReason.trim();
        if (!trimmed) {
            alert('사유를 입력해주세요.');
            return null;
        }
        return trimmed;
    };

    const upsertVacationRequestByDate = async ({ userId, date, type, periods, reason }) => {
        const { data: existingVacation, error: findError } = await supabase
            .from('vacation_requests')
            .select('id')
            .eq('user_id', userId)
            .eq('date', date)
            .in('type', ['full', 'half'])
            .limit(1)
            .maybeSingle();

        if (findError) throw findError;

        if (existingVacation) {
            const { error: updateError } = await supabase
                .from('vacation_requests')
                .update({
                    type,
                    periods,
                    reason,
                    status: 'approved'
                })
                .eq('id', existingVacation.id);

            if (updateError) throw updateError;
            return;
        }

        const { error: insertError } = await supabase
            .from('vacation_requests')
            .insert({
                user_id: userId,
                date,
                type,
                periods,
                reason,
                status: 'approved'
            });

        if (insertError) throw insertError;
    };

    // Long press handler - opens status popup
    const handleLongPress = (user, dateStr, period) => {
        openStatusPopup(user, dateStr, period);
    };

    const handleStatusSubmit = async () => {
        const { user, selectedDates, selectedPeriods, selectedReason } = statusPopup;
        if (!user) return;

        const targetDates = Array.from(new Set(selectedDates)).sort();
        if (targetDates.length === 0) {
            alert('날짜를 선택해주세요.');
            return;
        }

        const isVacationAction = VACATION_STATUS_KEYS.includes(selectedReason);
        if (!isVacationAction && selectedPeriods.length === 0) {
            alert('교시를 선택해주세요.');
            return;
        }

        if (isVacationAction) {
            try {
                if (selectedReason === 'vacation_cancel') {
                    const { count, error } = await supabase
                        .from('vacation_requests')
                        .delete({ count: 'exact' })
                        .eq('user_id', user.id)
                        .in('date', targetDates)
                        .in('type', ['full', 'half']);

                    if (error) throw error;
                    if (!count) {
                        alert('삭제된 휴가가 없습니다. 이미 삭제되었거나 권한이 없을 수 있습니다.');
                    } else {
                        setVacationData(prev => {
                            const next = { ...prev };
                            targetDates.forEach((targetDate) => {
                                delete next[`${user.id}_${targetDate}`];
                            });
                            return next;
                        });
                        alert('휴가가 취소되었습니다.');
                    }
                } else {
                    let type = 'full';
                    let periods = null;

                    if (selectedReason === 'vacation_half_am') {
                        type = 'half';
                        periods = [1, 2, 3, 4];
                    } else if (selectedReason === 'vacation_half_pm') {
                        type = 'half';
                        periods = [5, 6, 7];
                    }

                    for (const targetDate of targetDates) {
                        await upsertVacationRequestByDate({
                            userId: user.id,
                            date: targetDate,
                            type,
                            periods,
                            reason: null
                        });
                    }

                    setVacationData(prev => {
                        const next = { ...prev };
                        targetDates.forEach((targetDate) => {
                            next[`${user.id}_${targetDate}`] = { type, periods, reason: null, status: 'approved' };
                        });
                        return next;
                    });
                }
            } catch (e) {
                console.error('Error creating vacation:', e);
                alert(`휴가 등록에 실패했습니다: ${e.message}`);
                fetchData();
                return;
            }

            closeStatusPopup();
            autoAdvanceSelection(user.id);
            fetchData();
            return;
        }

        const finalReason = getValidatedPopupReason();
        if (!finalReason) return;
        const periodsToApply = Array.from(new Set(selectedPeriods)).sort((a, b) => a - b);

        try {
            const upserts = targetDates.flatMap((targetDate) => (
                periodsToApply.map((p) => ({
                    user_id: user.id,
                    date: targetDate,
                    period: p,
                    status: finalReason
                }))
            ));

            const { error } = await supabase
                .from('attendance_logs')
                .upsert(upserts, { onConflict: 'user_id,date,period' });

            if (error) throw error;
        } catch (e) {
            console.error(e);
            alert(`기타휴가 신청에 실패했습니다: ${e.message}`);
            fetchData();
            return;
        }

        setAttendanceData(prev => {
            const next = new Set(prev);
            targetDates.forEach((targetDate) => {
                periodsToApply.forEach((p) => next.add(`${user.id}_${targetDate}_${p}`));
            });
            return next;
        });
        setStatusData(prev => {
            const next = { ...prev };
            targetDates.forEach((targetDate) => {
                periodsToApply.forEach((p) => {
                    next[`${user.id}_${targetDate}_${p}`] = finalReason;
                });
            });
            return next;
        });

        closeStatusPopup();
        autoAdvanceSelection(user.id);
        fetchData();
    };

    const handleFixedStatusSubmit = async () => {
        const { user, selectedDates, selectedPeriods, selectedReason } = statusPopup;
        if (!user) return;

        const targetDates = Array.from(new Set(selectedDates)).sort();
        if (targetDates.length === 0) {
            alert('날짜를 선택해주세요.');
            return;
        }
        if (selectedPeriods.length === 0) {
            alert('교시를 선택해주세요.');
            return;
        }
        if (VACATION_STATUS_KEYS.includes(selectedReason)) {
            alert('고정신청은 사유입력으로만 가능합니다.');
            return;
        }

        const finalReason = getValidatedPopupReason();
        if (!finalReason) return;

        const periodsToApply = Array.from(new Set(selectedPeriods)).sort((a, b) => a - b);
        const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        const daysToRegister = new Set(
            targetDates.map((targetDate) => getDay(createDateFromYmd(targetDate)))
        );

        const selectedDayNames = Array.from(daysToRegister)
            .sort((a, b) => a - b)
            .map((d) => dayNames[d])
            .join(', ');

        const msg = `${user.name}님의 [매주 고정 일정]을 등록하시겠습니까?\n\n` +
            `요일: ${selectedDayNames}\n` +
            `사유: ${finalReason}\n` +
            `교시: ${periodsToApply.join(', ')}`;

        if (!confirm(msg)) return;

        try {
            const fixedInserts = Array.from(daysToRegister).map((dayOfWeek) => ({
                user_id: user.id,
                day_of_week: dayOfWeek,
                periods: periodsToApply,
                reason: finalReason
            }));

            const { error } = await supabase
                .from('fixed_leave_requests')
                .insert(fixedInserts);

            if (error) throw error;

            const immediateUpserts = targetDates.flatMap((targetDate) => (
                periodsToApply.map((p) => ({
                    user_id: user.id,
                    date: targetDate,
                    period: p,
                    status: finalReason
                }))
            ));

            const { error: applyError } = await supabase
                .from('attendance_logs')
                .upsert(immediateUpserts, { onConflict: 'user_id,date,period' });

            if (applyError) throw applyError;

            setAttendanceData(prev => {
                const next = new Set(prev);
                targetDates.forEach((targetDate) => {
                    periodsToApply.forEach((p) => next.add(`${user.id}_${targetDate}_${p}`));
                });
                return next;
            });
            setStatusData(prev => {
                const next = { ...prev };
                targetDates.forEach((targetDate) => {
                    periodsToApply.forEach((p) => {
                        next[`${user.id}_${targetDate}_${p}`] = finalReason;
                    });
                });
                return next;
            });

            alert('매주 고정 일정이 등록되었고, 선택한 날짜에는 즉시 반영되었습니다.\n[고정 기타 휴무 관리] 메뉴에서 확인할 수 있으며, 매주 월요일 00:00 (KST)에 자동 반영됩니다.');
            closeStatusPopup();
            autoAdvanceSelection(user.id);
            fetchData();
        } catch (e) {
            console.error(e);
            alert('고정 등록 실패: ' + e.message);
        }
    };

    const addDailyMemo = async (content) => {
        if (!content) return;
        try {
            const { data, error } = await supabase.from('attendance_memos').insert({ date: format(currentViewDate, 'yyyy-MM-dd'), branch, content }).select().single();
            if (error) throw error;
            setDailyMemos(prev => [...prev, data]);
        } catch (e) { alert('메모 등록 실패'); }
    };
    const updateDailyMemo = async (memo) => {
        const content = editingMemoText.trim();
        if (!content) return;

        try {
            const { data, error } = await supabase
                .from('attendance_memos')
                .update({ content })
                .eq('id', memo.id)
                .select()
                .single();
            if (error) throw error;
            setDailyMemos(prev => prev.map(item => item.id === memo.id ? { ...item, ...(data || {}), content } : item));
            setEditingMemoId(null);
            setEditingMemoText('');
        } catch (e) {
            alert('수정 실패');
        }
    };

    const deleteDailyMemo = async (id) => {
        if (!confirm('삭제하시겠습니까?')) return;
        try {
            await supabase.from('attendance_memos').delete().eq('id', id);
            setDailyMemos(prev => prev.filter(m => m.id !== id));
        } catch (e) { alert('삭제 실패'); }
    };

    const toggleSuggestionComplete = async (suggestion) => {
        try {
            const nextDbStatus = suggestion.status === 'completed' ? 'pending' : 'resolved';
            const { data: { user: authUser } } = await supabase.auth.getUser();

            const { error } = await supabase
                .from('suggestions')
                .update({
                    status: nextDbStatus,
                    resolved_at: nextDbStatus === 'resolved' ? new Date().toISOString() : null,
                    completed_by: nextDbStatus === 'resolved' ? authUser?.id : null
                })
                .eq('id', suggestion.id);

            if (error) throw error;
            fetchData();
        } catch (error) {
            console.error('Error updating suggestion:', error);
            alert('건의사항 상태 업데이트에 실패했습니다.');
        }
    };

    const handleSaveMemo = async (userId, content) => {
        try {
            // 1. Delete existing memos for this user
            const { error: deleteError } = await supabase
                .from('member_memos')
                .delete()
                .eq('user_id', userId);

            if (deleteError) throw deleteError;

            // 2. Insert new memo if content exists
            if (content) {
                const { error: insertError } = await supabase
                    .from('member_memos')
                    .insert({ user_id: userId, content: content });

                if (insertError) throw insertError;
            }

            // 3. Refresh memos locally
            // We could just refetch but let's try to update state optimistically or re-fetch all
            // Simple: Re-fetch all memos to be safe and consistent
            const { data, error } = await supabase.from('member_memos').select('*').order('created_at', { ascending: true });
            if (!error) {
                setMemberMemos(data || []);
                alert('저장되었습니다.');
                setIsPopupOpen(false);
                setHighlightedUserId(null); // Deselect
            }
        } catch (e) {
            console.error('Error saving memo:', e);
            alert('저장에 실패했습니다.');
        }
    };

    // Incoming Employee Functions
    const addIncomingEmployee = async (employee) => {
        try {
            const { data, error } = await supabase.from('incoming_employees').insert(employee).select().single();
            if (error) throw error;
            setIncomingEmployees(prev => [...prev, data].sort((a, b) => new Date(a.entry_date) - new Date(b.entry_date)));
        } catch (e) {
            console.error(e);
            alert('입사예정자 등록 실패');
        }
    };

    const updateIncomingEmployee = async (id, updates) => {
        try {
            const { error } = await supabase.from('incoming_employees').update(updates).eq('id', id);
            if (error) throw error;
            setIncomingEmployees(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
        } catch (e) {
            console.error(e);
            alert('수정 실패');
        }
    };

    const deleteIncomingEmployee = async (id) => {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        try {
            await supabase.from('incoming_employees').delete().eq('id', id);
            setIncomingEmployees(prev => prev.filter(e => e.id !== id));
        } catch (e) {
            console.error(e);
            alert('삭제 실패');
        }
    };

    const changeDate = (days) => {
        setCurrentViewDate(prev => addDays(prev, days));
    };

    const handleNameClick = (userId) => {
        if (!userId) return;
        if (highlightedUserId === userId) {
            // Toggle OFF
            setHighlightedUserId(null);
            setIsPopupOpen(false);
        } else {
            // Select New
            setHighlightedUserId(userId);
            setIsPopupOpen(true);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        if (!searchTerm.trim()) return;

        const found = displayRows.find(r => r.name && r.name.includes(searchTerm.trim()) && !r.isEmpty);
        if (found) {
            setHighlightedUserId(found.id);
            setIsPopupOpen(true); // Open popup when found
            setSearchTerm('');
            setIsSearchOpen(false);
        } else {
            alert('사용자를 찾을 수 없습니다.');
        }
        // Ensure scroll happens after state update and render
        setTimeout(() => {
            if (found && rowRefs.current[found.id]) {
                const rowEl = rowRefs.current[found.id];
                if (scrollContainerRef.current) {
                    const container = scrollContainerRef.current;
                    const targetScrollTop = rowEl.offsetTop - HEADER_TOTAL_HEIGHT;
                    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
                }
            }
        }, 100);
    };

    // Separator row configuration
    const TEAL_SEPARATOR_SEATS = [54, 102]; // 청록색 두꺼운 구분선 (열람실 구분)
    const THICK_SEPARATOR_SEATS = [7, 17, 22, 27, 32, 37, 42, 47, 52, 58, 62, 66, 70, 74, 78, 82, 83, 87, 90, 93, 96, 99];
    const THIN_SEPARATOR_SEATS = [9, 11, 13, 15, 50];

    const getSeparatorStyle = (seatNum) => {
        const numericSeat = Number(seatNum);
        if (TEAL_SEPARATOR_SEATS.includes(numericSeat)) {
            return { height: 6, color: '#267E82' }; // 청록색
        } else if (THICK_SEPARATOR_SEATS.includes(numericSeat)) {
            return { height: 4, color: '#718096' }; // 두꺼운 회색
        } else if (THIN_SEPARATOR_SEATS.includes(numericSeat)) {
            return { height: 2, color: '#a0aec0' }; // 얇은 회색
        }
        return null;
    };

    const getSeatStyle = (seatNum) => {
        let bgColor = 'white';
        const numericSeat = Number(seatNum);

        if (numericSeat >= 8 && numericSeat <= 17) bgColor = '#edf2f7';
        else if (numericSeat === 53 || numericSeat === 54) bgColor = '#cbd5e0';
        else if (numericSeat === 83) bgColor = '#fed7d7';
        return { bgColor };
    };

    const handleCellSelect = (user, dateStr, period) => {
        setSelectedCell({ userId: user.id, dateStr, period });
    };

    const autoAdvanceSelection = (currentUserId) => {
        const currentIndex = sortedRows.findIndex(u => u.id === currentUserId);
        if (currentIndex !== -1 && currentIndex < sortedRows.length - 1) {
            let nextIndex = currentIndex + 1;
            const nextUser = sortedRows[nextIndex];
            setSelectedCell(prev => ({ ...prev, userId: nextUser.id }));

            // Scroll if needed
            if (rowRefs.current[nextUser.id]) {
                const rowEl = rowRefs.current[nextUser.id];
                if (scrollContainerRef.current) {
                    const container = scrollContainerRef.current;
                    const rowTop = rowEl.offsetTop;
                    const rowBottom = rowTop + rowEl.offsetHeight;
                    const containerTop = container.scrollTop + HEADER_TOTAL_HEIGHT;
                    const containerBottom = container.scrollTop + container.clientHeight;

                    if (rowBottom > containerBottom) {
                        container.scrollTo({ top: container.scrollTop + rowEl.offsetHeight, behavior: 'smooth' });
                    } else if (rowTop < containerTop) {
                        container.scrollTo({ top: rowTop - HEADER_TOTAL_HEIGHT, behavior: 'smooth' });
                    }
                }
            }
        }
    };

    const handleActionInput = async (type) => {
        if (!selectedCell) return;
        const { userId, dateStr, period } = selectedCell;
        const user = displayRows.find(u => u.id === userId);
        if (!user) return;

        // 1. Perform UI Logic (Auto-Advance) IMMEDIATELY
        if (type === 'O' || type === 'X') {
            autoAdvanceSelection(userId);
        } else if (type === 'OTHER') {
            openStatusPopup(user, dateStr, period);
            return; // Don't auto advance for OTHER (yet)
        }

        // 2. Perform Business Logic (State/DB Update) in Background
        (async () => {
            if (type === 'O') {
                const key = `${userId}_${dateStr}_${period}`;
                const isAttended = attendanceData.has(key);
                const status = statusData[key];

                if (!isAttended || status) {
                    if (isAttended) {
                        if (status) {
                            setAttendanceData(prev => prev.add(key));
                            setStatusData(prev => { const n = { ...prev }; delete n[key]; return n; });
                            try {
                                await supabase.from('attendance_logs').update({ status: null }).eq('user_id', user.id).eq('date', dateStr).eq('period', period);
                            } catch (e) { fetchData(); }
                        }
                    } else {
                        await toggleAttendance(user, dateStr, period);
                    }
                }
            } else if (type === 'X') {
                const key = `${userId}_${dateStr}_${period}`;
                const isAttended = attendanceData.has(key);
                if (isAttended) {
                    await toggleAttendance(user, dateStr, period);
                }
            }
        })();
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'white' }}>
            {/* Header: Row 1 Date (Top), Row 2 Memo (Bottom) */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                {/* Row 1: Search + Date */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(86px, 0.72fr) minmax(168px, 1.28fr)', alignItems: 'center', gap: '8px', padding: '10px 10px 4px 10px' }}>
                    <div style={{ minWidth: 0 }}>
                        {isSearchOpen ? (
                            <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', height: '32px', boxSizing: 'border-box', minWidth: 0, width: '100%',
                                    background: 'white', border: '1px solid #cbd5e0', borderRadius: '20px',
                                    padding: '0 10px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                }}>
                                    <Search size={16} color="#a0aec0" style={{ marginRight: '5px', flexShrink: 0 }} />
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder="이름 검색"
                                        style={{
                                            border: 'none', outline: 'none', fontSize: '0.85rem', width: '100%', minWidth: 0, color: '#4a5568'
                                        }}
                                        autoFocus
                                        onBlur={() => {
                                            if (!searchTerm) setIsSearchOpen(false);
                                        }}
                                    />
                                </div>
                                <button type="submit" style={{ display: 'none' }}></button>
                            </form>
                        ) : (
                            <button
                                onClick={() => setIsSearchOpen(true)}
                                style={{
                                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '20px',
                                    padding: '6px 8px', fontSize: 'clamp(0.65rem, 2.5vw, 0.85rem)', color: '#718096', fontWeight: 'bold',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', cursor: 'pointer',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)', height: '32px', whiteSpace: 'nowrap', width: '100%', overflow: 'hidden'
                                }}
                            >
                                <Search size={14} />
                                <span>이름검색</span>
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', minWidth: 0, transform: 'translateX(5px)' }}>
                        <button onClick={() => changeDate(-1)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px', flexShrink: 0 }}>
                            <ChevronLeft size={22} color="#4a5568" />
                        </button>
                        <span style={{ fontSize: 'clamp(1rem, 4vw, 1.2rem)', fontWeight: 'bold', color: '#2d3748', minWidth: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {format(currentViewDate, 'yyyy.MM.dd (EEE)', { locale: ko })}
                        </span>
                        <button onClick={() => changeDate(1)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px', flexShrink: 0 }}>
                            <ChevronRight size={22} color="#4a5568" />
                        </button>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '5px', padding: '4px 10px 8px 10px' }}>
                    <button
                        onClick={() => pendingSuggestionCount > 0 && setShowSuggestionModal(true)}
                        disabled={pendingSuggestionCount === 0}
                        style={getQuickButtonStyle(pendingSuggestionCount > 0)}
                    >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>회원건의</span>
                    </button>
                    <button
                        onClick={() => sideDishSummary.hasAny && setShowSideDishModal(true)}
                        disabled={!sideDishSummary.hasAny}
                        style={getQuickButtonStyle(sideDishSummary.hasAny)}
                    >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>반찬신청</span>
                    </button>
                    <button
                        onClick={() => setShowTodoModal(true)}
                        style={getQuickButtonStyle(true)}
                    >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>할일목록</span>
                        {staffTodoCount > 0 && <CountBadge count={staffTodoCount} />}
                    </button>
                    <button
                        onClick={() => setShowMemoModal(true)}
                        style={getQuickButtonStyle(true, 'blue')}
                    >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>출석참고</span>
                        {dailyMemos.length > 0 && <CountBadge count={dailyMemos.length} />}
                    </button>
                </div>

            </div>

            <div
                ref={scrollContainerRef}
                style={{
                    flex: 1, overflow: 'auto', position: 'relative', touchAction: 'pan-x pan-y',
                    display: 'flex', justifyContent: 'center'
                }}
            >
                <div ref={contentRef} style={{ width: 'max-content', transformOrigin: '0 0', alignSelf: 'flex-start' }}>
                    {/* Fixed Header */}
                    <div style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', width: 'max-content', backgroundColor: '#f7fafc', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                        {/* Sticky Columns Left Header */}
                        <div style={{ position: 'sticky', left: 0, zIndex: 40, display: 'flex', height: HEADER_TOTAL_HEIGHT, backgroundColor: '#f7fafc', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.1)' }}>
                            <div style={{ width: SEAT_WIDTH, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: `${0.85 * scale}rem`, color: '#4a5568' }}>좌석</div>
                            <div style={{ width: NAME_WIDTH, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: `${0.85 * scale}rem`, color: '#4a5568' }}>이름</div>
                        </div>
                        {/* Day Header - Dynamic Day */}
                        <div style={{ display: 'flex' }}>
                            {daysInView.map(date => (
                                <div key={format(date, 'yyyy-MM-dd')} style={{ display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ height: HEADER_DATE_HEIGHT, width: DAY_WIDTH, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ebf8ff', color: '#2b6cb0', fontWeight: 'bold', fontSize: `${0.9 * scale}rem` }}>
                                        {format(date, 'M.d(EEE)', { locale: ko })}
                                    </div>
                                    <div style={{ display: 'flex', height: HEADER_PERIOD_HEIGHT }}>
                                        {[1, 2, 3, 4, 5, 6, 7].map(p => (
                                            <div key={p} style={{ width: PERIOD_WIDTH, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${0.8 * scale}rem`, color: '#718096' }}>{p}</div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Rows */}
                    <div style={{ width: 'max-content', paddingBottom: '100px' }}>
                        {sortedRows.map(user => {
                            const isDeactivated = user.isEmpty;
                            // Allow highlighting for unassigned users too (user.isUnassigned)
                            const isRowHighlighted = highlightedUserId === user.id && !user.isEmpty;
                            const isAnyHighlighted = highlightedUserId !== null;
                            const { bgColor } = getSeatStyle(user.seat_number);
                            let rowOpacity = isAnyHighlighted ? (isRowHighlighted ? 1 : 0.4) : 1;
                            // Use distinct background for unassigned users if not highlighted
                            let stickyBg = isRowHighlighted ? '#ebf8ff' : (user.isEmpty ? '#f7fafc' : (user.isUnassigned ? 'white' : bgColor));
                            const separatorStyle = getSeparatorStyle(user.seat_number);

                            return (
                                <React.Fragment key={user.id}>
                                    <div
                                        ref={el => rowRefs.current[user.id] = el}
                                        style={{ display: 'flex', height: ROW_HEIGHT, borderBottom: '1px solid #edf2f7', opacity: rowOpacity, transition: 'opacity 0.2s, transform 0.3s' }}
                                    >
                                        {/* Sticky Name/Seat */}
                                        <div style={{ position: 'sticky', left: 0, zIndex: 10, display: 'flex', boxShadow: '2px 0 5px -2px rgba(0,0,0,0.1)', alignItems: 'flex-start', backgroundColor: stickyBg, height: '100%' }}>
                                            {isRowHighlighted && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, borderTop: '2px solid #3182ce', borderBottom: '2px solid #3182ce', borderLeft: '2px solid #3182ce', pointerEvents: 'none', zIndex: 20 }} />}
                                            <div style={{ width: SEAT_WIDTH, height: ROW_HEIGHT, borderRight: '1px solid #edf2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', background: stickyBg, color: user.isEmpty ? '#cbd5e0' : '#a0aec0', fontSize: `${0.8 * scale}rem` }}>{user.seat_number || '-'}</div>
                                            <div onClick={() => handleNameClick(user.id)} style={{ width: NAME_WIDTH, height: ROW_HEIGHT, borderRight: '1px solid #edf2f7', display: 'flex', alignItems: 'center', justifyContent: 'center', background: stickyBg, color: '#2d3748', fontSize: `${0.9 * scale}rem`, fontWeight: user.isEmpty ? 'normal' : 'bold', cursor: user.isEmpty ? 'default' : 'pointer' }}>{user.name}</div>
                                        </div>
                                        {/* Scrollable Day Data */}
                                        <div style={{ display: 'flex', position: 'relative' }}>
                                            {isRowHighlighted && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, borderTop: '2px solid #3182ce', borderBottom: '2px solid #3182ce', pointerEvents: 'none', zIndex: 5 }} />}
                                            {daysInView.map(date => {
                                                const dateStr = format(date, 'yyyy-MM-dd');
                                                const seatIncoming = incomingBySeat[Number(user.seat_number)] || [];
                                                const shouldShowIncoming = !isDeactivated && seatIncoming.length > 0 && shouldShowIncomingForDate(dateStr);

                                                if (shouldShowIncoming) {
                                                    const allChecked = seatIncoming.every((emp) => emp.isChecked);
                                                    const incomingBg = allChecked ? '#c6f6d5' : '#fefcbf';
                                                    const incomingText = allChecked ? '#22543d' : '#975a16';
                                                    const incomingBorder = allChecked ? '#9ae6b4' : '#f6e05e';
                                                    const infoText = seatIncoming
                                                        .map((emp) => `${format(new Date(`${emp.expected_start_date}T00:00:00`), 'M/d')} ${emp.name}(${emp.plaqueText}) ${emp.beverageText}`)
                                                        .join(' / ');

                                                    return (
                                                        <div
                                                            key={dateStr}
                                                            style={{
                                                                display: 'flex',
                                                                height: ROW_HEIGHT,
                                                                width: DAY_WIDTH,
                                                                background: incomingBg,
                                                                color: incomingText,
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontWeight: 'bold',
                                                                fontSize: `${0.72 * scale}rem`,
                                                                borderBottom: '1px solid #e2e8f0',
                                                                borderRight: '1px solid #e2e8f0',
                                                                borderLeft: `1px solid ${incomingBorder}`,
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                padding: '0 6px',
                                                                boxSizing: 'border-box'
                                                            }}
                                                        >
                                                            {infoText}
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div key={dateStr} style={{ display: 'flex', height: ROW_HEIGHT }}>
                                                        {[1, 2, 3, 4, 5, 6, 7].map(p => (
                                                            <AttendanceCell
                                                                key={p}
                                                                user={user}
                                                                dateStr={dateStr}
                                                                period={p}
                                                                isRowHighlighted={isRowHighlighted}
                                                                isSelected={selectedCell?.userId === user.id && selectedCell?.dateStr === dateStr && selectedCell?.period === p}
                                                                onSelect={handleCellSelect}
                                                                attendanceData={attendanceData}
                                                                statusData={statusData}
                                                                vacationData={vacationData}
                                                                onLongPress={handleLongPress}
                                                                width={PERIOD_WIDTH}
                                                                scale={scale}
                                                            />
                                                        ))}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                    {/* Separator Row */}
                                    {separatorStyle && (
                                        <div style={{ height: separatorStyle.height, backgroundColor: separatorStyle.color, width: '100%' }} />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom Popup Section */}
            {isPopupOpen && selectedUser && (
                <div style={{ height: '50%', flexShrink: 0, zIndex: 50 }}>
                    <UserMemoPopup
                        user={selectedUser}
                        memberMemos={memberMemos}
                        onSave={handleSaveMemo}
                        onClose={() => {
                            setIsPopupOpen(false);
                            setHighlightedUserId(null);
                        }}
                    />
                </div>
            )}

            {/* Member Suggestions Modal */}
            {showSuggestionModal && createPortal(
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '460px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '15px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2f855a' }}>회원 건의사항</h3>
                            <button onClick={() => setShowSuggestionModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><X size={24} color="#a0aec0" /></button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f7fafc' }}>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'none', flexDirection: 'column', gap: '10px' }}>
                                {dailyMemos.length === 0 && <li style={{ color: '#a0aec0', textAlign: 'center' }}>등록된 참고사항이 없습니다.</li>}
                                {dailyMemos.map((memo, idx) => {
                                    const isEditingMemo = editingMemoId === memo.id;
                                    const memoButtonStyle = {
                                        border: '1px solid #cbd5e0',
                                        borderRadius: '999px',
                                        padding: '6px 10px',
                                        minWidth: '36px',
                                        height: '30px',
                                        background: 'white',
                                        color: '#4a5568',
                                        fontSize: '0.78rem',
                                        cursor: 'pointer',
                                        fontWeight: '800',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '4px',
                                        flexShrink: 0
                                    };

                                    return (
                                        <li key={memo.id} style={{ background: memo.isSystemIncoming ? '#fffaf0' : 'white', padding: '12px', borderRadius: '12px', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 1, minWidth: 0 }}>
                                                <span style={{ fontWeight: 'bold', color: '#3182ce', minWidth: '20px' }}>{idx + 1}.</span>
                                                {isEditingMemo ? (
                                                    <input
                                                        type="text"
                                                        value={editingMemoText}
                                                        onChange={(e) => setEditingMemoText(e.target.value)}
                                                        autoFocus
                                                        style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: '10px', fontSize: '0.92rem', outline: 'none' }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') updateDailyMemo(memo);
                                                            if (e.key === 'Escape') {
                                                                setEditingMemoId(null);
                                                                setEditingMemoText('');
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    <span style={{ color: '#4a5568', wordBreak: 'break-all', lineHeight: 1.4 }}>{memo.content}</span>
                                                )}
                                            </div>
                                            {!memo.isSystemIncoming && (
                                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                    <button
                                                        onClick={() => {
                                                            if (isEditingMemo) {
                                                                updateDailyMemo(memo);
                                                                return;
                                                            }
                                                            setEditingMemoId(memo.id);
                                                            setEditingMemoText(memo.content || '');
                                                        }}
                                                        style={memoButtonStyle}
                                                    >
                                                        ✏️ {isEditingMemo ? '저장' : '수정'}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            if (isEditingMemo) {
                                                                setEditingMemoId(null);
                                                                setEditingMemoText('');
                                                                return;
                                                            }
                                                            deleteDailyMemo(memo.id);
                                                        }}
                                                        style={memoButtonStyle}
                                                    >
                                                        X
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {sortedMemberSuggestions.length === 0 && <li style={{ color: '#a0aec0', textAlign: 'center' }}>등록된 건의사항이 없습니다.</li>}
                                {sortedMemberSuggestions.map((suggestion) => {
                                    const isCompleted = suggestion.status === 'completed';

                                    return (
                                        <li
                                            key={suggestion.id}
                                            style={{
                                                background: isCompleted ? 'white' : '#f0fff4',
                                                border: `1px solid ${isCompleted ? '#e2e8f0' : '#9ae6b4'}`,
                                                borderRadius: '12px',
                                                padding: '12px',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '8px'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                <button
                                                    onClick={() => toggleSuggestionComplete(suggestion)}
                                                    style={{
                                                        border: 'none',
                                                        background: 'none',
                                                        cursor: 'pointer',
                                                        color: isCompleted ? '#a0aec0' : '#2f855a',
                                                        padding: 0,
                                                        marginTop: '2px',
                                                        display: 'flex',
                                                        alignItems: 'center'
                                                    }}
                                                >
                                                    {isCompleted ? <CheckSquare size={18} /> : <Square size={18} />}
                                                </button>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: '0.95rem',
                                                        color: isCompleted ? '#718096' : '#2d3748',
                                                        textDecoration: isCompleted ? 'line-through' : 'none',
                                                        whiteSpace: 'pre-wrap',
                                                        wordBreak: 'break-word',
                                                        lineHeight: 1.4
                                                    }}>
                                                        {suggestion.content}
                                                    </div>
                                                    <div style={{ fontSize: '0.72rem', color: '#718096', marginTop: '5px' }}>
                                                        요청:{suggestion.authorName}
                                                        {suggestion.completerName && ` /완료:${suggestion.completerName}`}
                                                    </div>
                                                </div>
                                            </div>

                                            {Array.isArray(suggestion.replies) && suggestion.replies.length > 0 && (
                                                <div style={{ marginLeft: '26px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    {suggestion.replies.map((reply) => (
                                                        <div
                                                            key={reply.id}
                                                            style={{
                                                                border: '1px solid #e2e8f0',
                                                                borderRadius: '10px',
                                                                background: 'white',
                                                                padding: '8px 10px'
                                                            }}
                                                        >
                                                            <div style={{ fontSize: '0.72rem', color: '#718096', marginBottom: '4px' }}>
                                                                답글 · {reply.authorName} · {formatSuggestionReplyTime(reply.createdAt)}
                                                            </div>
                                                            <div style={{ fontSize: '0.84rem', color: '#2d3748', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                                {reply.text}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Daily Memos Modal */}
            {showMemoModal && createPortal(
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '400px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '15px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2d3748' }}>{format(currentViewDate, 'yyyy.MM.dd')} 참고사항</h3>
                            <button onClick={() => setShowMemoModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><X size={24} color="#a0aec0" /></button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f7fafc' }}>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {dailyMemos.length === 0 && <li style={{ color: '#a0aec0', textAlign: 'center' }}>등록된 참고사항이 없습니다.</li>}
                                {dailyMemos.map((memo, idx) => (
                                    <li key={memo.id} style={{ background: memo.isSystemIncoming ? '#fffaf0' : 'white', padding: '12px', borderRadius: '12px', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 1 }}><span style={{ fontWeight: 'bold', color: '#3182ce', minWidth: '20px' }}>{idx + 1}.</span><span style={{ color: '#4a5568', wordBreak: 'break-all', lineHeight: 1.4 }}>{memo.content}</span></div>
                                        {!memo.isSystemIncoming && (
                                            <button onClick={() => deleteDailyMemo(memo.id)} style={{ background: '#fff5f5', color: '#e53e3e', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '0.8rem', cursor: 'pointer', marginLeft: '10px', fontWeight: 'bold' }}>삭제</button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div style={{ padding: '20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px', background: 'white', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
                            <input type="text" value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder="참고사항을 입력하세요" style={{ flex: 1, padding: '12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '0.95rem', outline: 'none' }} onKeyPress={(e) => e.key === 'Enter' && addDailyMemo(newMemo.trim())} />
                            <button onClick={() => { addDailyMemo(newMemo.trim()); setNewMemo(''); }} style={{ background: '#3182ce', color: 'white', border: 'none', borderRadius: '10px', padding: '0 20px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}><Plus size={18} />등록</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Todo Modal */}
            {showTodoModal && createPortal(
                <div
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowTodoModal(false);
                    }}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}
                >
                    <div style={{ background: 'white', borderRadius: '16px', width: 'min(720px, calc(100vw - 24px))', height: 'min(82vh, 760px)', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                            <h3 style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#2d3748', margin: 0 }}>할일목록</h3>
                            <button onClick={() => setShowTodoModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                <X size={24} color={'#a0aec0'} />
                            </button>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px', background: '#f7fafc' }}>
                            <StaffTaskBoard
                                embedded
                                initialView={'tasks'}
                                lockView
                                defaultBranch={branch}
                                hideSideDishAction
                            />
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Side Dish Modal */}
            {showSideDishModal && createPortal(
                <div
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowSideDishModal(false);
                    }}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}
                >
                    <div style={{ background: 'white', borderRadius: '16px', width: 'min(520px, calc(100vw - 24px))', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 16px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#2d3748', margin: 0 }}>반찬신청</h3>
                            <button onClick={() => setShowSideDishModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                <X size={24} color={'#a0aec0'} />
                            </button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '14px', background: '#f7fafc', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {renderSideDishPeriodList('점심 반찬 신청', sideDishSummary.am)}
                            {renderSideDishPeriodList('저녁 반찬 신청', sideDishSummary.pm)}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Status Selection Popup */}
            <StatusPopup
                popup={statusPopup}
                onClose={closeStatusPopup}
                onToggleDate={toggleStatusPopupDate}
                onCalendarMonthChange={handleStatusPopupMonthChange}
                onTogglePeriod={toggleStatusPopupPeriod}
                onReasonSelect={handlePopupReasonSelect}
                onInstantCancel={handlePopupInstantCancel}
                onPresetReasonSelect={handlePopupPresetReasonSelect}
                onCustomReasonChange={handlePopupCustomReasonChange}
                onSubmit={handleStatusSubmit}
                onFixedSubmit={handleFixedStatusSubmit}
            />

            {/* Bottom Control Bar - Restored and Optimized */}
            <div style={{
                flexShrink: 0,
                height: '60px',
                backgroundColor: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 15px',
                zIndex: 100,
                boxShadow: '0 -2px 10px rgba(0,0,0,0.08)',
                borderTop: '1px solid #e2e8f0',
                gap: '10px'
            }}>
                {/* Left Side: Selected User Info */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {selectedCell && (() => {
                        const activeUser = displayRows.find(u => u.id === selectedCell.userId);
                        if (!activeUser) return null;
                        return (
                            <>
                                <span style={{ fontSize: '0.75rem', color: '#718096' }}>{activeUser.seat_number ? `좌석 ${activeUser.seat_number}` : '-'}</span>
                                <span style={{
                                    fontSize: '1rem',
                                    fontWeight: 'bold',
                                    color: '#2d3748',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                    {activeUser.name}
                                </span>
                            </>
                        );
                    })()}
                </div>

                {/* Right Side: Action Buttons */}
                <div style={{ display: 'flex', gap: '6px', height: '44px' }}>
                    <button
                        onClick={() => handleActionInput('O')}
                        style={{
                            width: '55px', height: '100%',
                            borderRadius: '10px', border: 'none',
                            background: '#c6f6d5', color: '#22543d',
                            fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        O
                    </button>
                    <button
                        onClick={() => handleActionInput('X')}
                        style={{
                            width: '55px', height: '100%',
                            borderRadius: '10px', border: 'none',
                            background: '#fed7d7', color: '#c53030',
                            fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        X
                    </button>
                    <button
                        onClick={() => handleActionInput('OTHER')}
                        style={{
                            width: '55px', height: '100%',
                            borderRadius: '10px', border: '1px solid #cbd5e0',
                            background: 'white', color: '#4a5568',
                            fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        기타
                    </button>
                    <button
                        onClick={() => {
                            if (selectedCell) autoAdvanceSelection(selectedCell.userId);
                        }}
                        style={{
                            width: '55px', height: '100%',
                            borderRadius: '10px', border: 'none',
                            background: '#edf2f7', color: '#4a5568',
                            fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                    >
                        <CornerDownLeft size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StaffDailyAttendance;

