import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const getKstDateStr = (timestamp = Date.now()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date(timestamp));

    const partMap = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            partMap[part.type] = part.value;
        }
    });

    return `${partMap.year}-${partMap.month}-${partMap.day}`;
};

const EmbeddedCalendar = ({
    selectedDate,       // Single date (backward compatibility)
    selectedDates = [], // Array of dates for multi-select
    onSelectDate,
    events = [], // Array of objects: { date: 'YYYY-MM-DD', type: 'full'|'half'|'special', ... }
    minDate,
    maxDate,
    // New props for controlled mode
    currentMonth: controlledMonth,
    onMonthChange,
    compact = false,
    showEvents = true,
    topAlignedDays = false,
    condensedEvents = false
}) => {
    // Internal state for uncontrolled mode
    const [internalMonth, setInternalMonth] = useState(() => {
        const d = selectedDate ? new Date(selectedDate) : (selectedDates.length > 0 ? new Date(selectedDates[0]) : new Date());
        return isNaN(d.getTime()) ? new Date() : d;
    });

    // Use controlled value if provided, otherwise internal
    const currentMonth = controlledMonth || internalMonth;

    useEffect(() => {
        if (selectedDate && !controlledMonth) {
            const d = new Date(selectedDate);
            if (!isNaN(d.getTime())) {
                setInternalMonth(d);
            }
        }
    }, [selectedDate, controlledMonth]);

    const handlePrevMonth = () => {
        const newDate = new Date(currentMonth);
        newDate.setMonth(newDate.getMonth() - 1);

        if (onMonthChange) {
            onMonthChange(newDate);
        } else {
            setInternalMonth(newDate);
        }
    };

    const handleNextMonth = () => {
        const newDate = new Date(currentMonth);
        newDate.setMonth(newDate.getMonth() + 1);

        if (onMonthChange) {
            onMonthChange(newDate);
        } else {
            setInternalMonth(newDate);
        }
    };

    const getDaysInMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        return new Date(year, month + 1, 0).getDate();
    };

    const getFirstDayOfMonth = (date) => {
        return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    };

    const isDateDisabled = (dateStr) => {
        if (minDate && dateStr < minDate) return true;
        if (maxDate && dateStr > maxDate) return true;
        return false;
    };

    const renderCalendarDays = () => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const daysInMonth = getDaysInMonth(currentMonth);
        const firstDay = getFirstDayOfMonth(currentMonth);
        const todayKst = getKstDateStr();

        const days = [];

        // Add empty cells for padding before 1st day
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} style={{ minHeight: compact ? (condensedEvents ? '30px' : '36px') : '48px' }}></div>);
        }

        // Render actual days
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            // Find all events for this day
            const dayEvents = events.filter(e => e.date === dateStr);

            // Check selection (Single OR Multi)
            const isSelected = selectedDate === dateStr || selectedDates.includes(dateStr);

            const disabled = isDateDisabled(dateStr);
            const isToday = dateStr === todayKst;

            // Determine cell base styles
            let cellBgColor = 'transparent';
            let cellTextColor = '#2d3748';
            let cellBorderColor = 'transparent';
            let fontWeight = 'normal';

            // Selection Overlay (Highest Priority)
            if (isSelected) {
                cellBgColor = 'var(--color-primary)';
                cellTextColor = 'white';
                fontWeight = 'bold';
            } else if (isToday) {
                cellBorderColor = 'var(--color-primary)';
            }

            // Disabled State
            if (disabled) {
                cellTextColor = '#cbd5e0';
                cellBgColor = '#f7fafc';
                if (isSelected) {
                    cellBgColor = '#e2e8f0'; // Dimmed selected
                }
            }

            // Border for days with events (if not selected/disabled)
            if (!isSelected && !disabled && !isToday && dayEvents.length > 0) {
                cellBorderColor = '#cbd5e0';
            }

            const shouldRenderEvents = showEvents && dayEvents.length > 0 && !isSelected;
            const alignTop = topAlignedDays || shouldRenderEvents;
            days.push(
                <div
                    key={dateStr}
                    onClick={() => !disabled && onSelectDate(dateStr)}
                    style={{
                        minHeight: compact ? (condensedEvents ? '30px' : '36px') : '60px',
                        height: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: alignTop ? 'flex-start' : 'center',
                        gap: alignTop ? (condensedEvents ? '2px' : '4px') : '0',
                        padding: compact ? (condensedEvents ? '2px 1px' : '3px 2px') : '6px 4px',
                        background: cellBgColor,
                        color: cellTextColor,
                        border: isSelected ? 'none' : `1px solid ${cellBorderColor}`,
                        borderRadius: compact ? '10px' : '12px',
                        fontWeight: fontWeight,
                        fontSize: compact ? '0.85rem' : '0.9rem',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                        position: 'relative'
                    }}
                >
                    <span style={{ marginBottom: alignTop ? '2px' : 0, lineHeight: 1 }}>{d}</span>
                    {shouldRenderEvents && (() => {
                        // Group events by unique labels to avoid duplicates on calendar
                        const uniqueLabels = [];
                        const seenLabels = new Set();

                        dayEvents.forEach(event => {
                            let label = '';
                            let itemBgColor = 'transparent';
                            let itemTextColor = '#2d3748';
                            let itemBorderColor = 'transparent';

                            const isAm = (event.periods || []).includes(1);

                            // 1. Base Label
                            if (event.type === 'full') {
                                label = '월차';
                                itemBgColor = '#ffffff';
                                itemTextColor = '#c53030'; // Red text
                                itemBorderColor = '#fc8181'; // Red border
                            } else if (event.type === 'half') {
                                if (isAm) {
                                    label = '오전';
                                    itemBgColor = '#ffffff';
                                    itemTextColor = '#c53030'; // Red text for AM
                                    itemBorderColor = '#fc8181'; // Red border for AM (matching screenshot style usually)
                                } else {
                                    label = '오후';
                                    itemBgColor = '#ffffff';
                                    itemTextColor = '#3182ce'; // Blue text
                                    itemBorderColor = '#63b3ed'; // Blue border
                                }
                            } else if (event.type === 'special') {
                                label = '특휴';
                                itemBgColor = '#ffffff';
                                itemTextColor = '#553c9a';
                                itemBorderColor = '#b794f4';
                            }

                            // 2. Reason Override
                            if (event.reason) {
                                label = event.reason;
                                if (event.reason === '신청') {
                                    itemBgColor = '#ffffff';
                                    itemTextColor = '#2f855a';
                                    itemBorderColor = '#9ae6b4';
                                } else {
                                    // Default Gray Style for other reasons
                                    itemBgColor = '#ffffff';
                                    itemTextColor = '#4A5568';
                                    itemBorderColor = '#CBD5E0';
                                }
                            }

                            // Only add if we haven't seen this label
                            if (!seenLabels.has(label)) {
                                seenLabels.add(label);
                                uniqueLabels.push({ label, itemBgColor, itemTextColor, itemBorderColor });
                            }
                        });

                        return (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: condensedEvents ? '1px' : '2px',
                                width: '100%'
                            }}>
                                {uniqueLabels.map((item, idx) => (
                                    <div key={idx} style={{
                                        fontSize: condensedEvents ? '0.62rem' : '0.7rem',
                                        fontWeight: 'bold',
                                        color: item.itemTextColor,
                                        backgroundColor: '#ffffff', // White background
                                        border: `1px solid ${item.itemBorderColor}`, // Colored border
                                        borderRadius: '12px', // Rounded pill
                                        padding: condensedEvents ? '1px 0' : '3px 0',
                                        width: '100%',
                                        textAlign: 'center',
                                        lineHeight: 1.2,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}>
                                        {item.label}
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            );
        }
        return days;
    };

    return (
        <div style={{ width: '100%', userSelect: 'none' }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: compact ? (condensedEvents ? '4px' : '6px') : '10px',
                gap: compact ? (condensedEvents ? '6px' : '10px') : '15px'
            }}>
                <button
                    onClick={handlePrevMonth}
                    style={{
                        background: 'none',
                        border: 'none',
                        padding: compact ? '3px' : '5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        color: '#4a5568'
                    }}
                >
                    <ChevronLeft size={compact ? 20 : 24} />
                </button>
                <span style={{ fontSize: compact ? '1rem' : '1.1rem', fontWeight: 'bold', color: '#2d3748' }}>
                    {currentMonth instanceof Date && !isNaN(currentMonth) ? `${currentMonth.getFullYear()}년 ${currentMonth.getMonth() + 1}월` : ''}
                </span>
                <button
                    onClick={handleNextMonth}
                    style={{
                        background: 'none',
                        border: 'none',
                        padding: compact ? '3px' : '5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        color: '#4a5568'
                    }}
                >
                    <ChevronRight size={compact ? 20 : 24} />
                </button>
            </div>

            {/* Week Days */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                marginBottom: compact ? (condensedEvents ? '1px' : '2px') : '5px',
                textAlign: 'center'
            }}>
                {['일', '월', '화', '수', '목', '금', '토'].map((day, idx) => (
                    <div key={day} style={{
                        fontSize: compact ? '0.75rem' : '0.8rem',
                        fontWeight: 'bold',
                        color: idx === 0 ? '#e53e3e' : idx === 6 ? '#3182ce' : '#718096',
                        padding: compact ? (condensedEvents ? '1px 0' : '2px 0') : '5px 0'
                    }}>
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: compact ? (condensedEvents ? '2px' : '3px') : '5px'
            }}>
                {renderCalendarDays()}
            </div>
        </div>
    );
};

export default EmbeddedCalendar;
