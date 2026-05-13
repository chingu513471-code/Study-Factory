import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CheckSquare, Square } from 'lucide-react';
import {
    addDays,
    addMonths,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    startOfMonth,
    startOfWeek,
    subMonths
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

const getDateTone = (dateStr, isChecked) => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    if (dateStr < todayStr) {
        return {
            bg: '#edf2f7',
            border: '#cbd5e0',
            text: '#4a5568'
        };
    }
    if (isChecked) {
        return {
            bg: '#c6f6d5',
            border: '#9ae6b4',
            text: '#22543d'
        };
    }
    return {
        bg: '#fefcbf',
        border: '#f6e05e',
        text: '#975a16'
    };
};

const StaffNewHireSchedule = ({ onBack }) => {
    const { user } = useAuth();
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [pendingEmployees, setPendingEmployees] = useState([]);
    const [todosByPending, setTodosByPending] = useState({});
    const [loading, setLoading] = useState(true);
    const [updatingIds, setUpdatingIds] = useState(new Set());

    const branchFilter = user?.branch && user.branch !== '전체' && user.branch !== '미정' ? user.branch : null;

    const fetchData = async () => {
        setLoading(true);
        try {
            let pendingQuery = supabase
                .from('pending_registrations')
                .select('*')
                .is('linked_user_id', null)
                .order('expected_start_date', { ascending: true });

            let todosQuery = supabase
                .from('staff_todos')
                .select('id, pending_registration_id, status')
                .not('pending_registration_id', 'is', null);

            if (branchFilter) {
                pendingQuery = pendingQuery.eq('branch', branchFilter);
                todosQuery = todosQuery.eq('branch', branchFilter);
            }

            const [pendingRes, todoRes] = await Promise.all([
                pendingQuery,
                todosQuery
            ]);

            if (pendingRes.error) throw pendingRes.error;
            if (todoRes.error) throw todoRes.error;

            const groupedTodos = {};
            (todoRes.data || []).forEach((todo) => {
                if (!todo.pending_registration_id) return;
                if (!groupedTodos[todo.pending_registration_id]) groupedTodos[todo.pending_registration_id] = [];
                groupedTodos[todo.pending_registration_id].push(todo);
            });

            setPendingEmployees(pendingRes.data || []);
            setTodosByPending(groupedTodos);
        } catch (error) {
            console.error('Error fetching new hire schedule:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        const pendingChannel = supabase
            .channel('new_hire_pending_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'pending_registrations'
            }, fetchData)
            .subscribe();

        const todoChannel = supabase
            .channel('new_hire_todo_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'staff_todos',
                filter: 'pending_registration_id=not.is.null'
            }, fetchData)
            .subscribe();

        return () => {
            pendingChannel.unsubscribe();
            todoChannel.unsubscribe();
        };
    }, [branchFilter]);

    const hires = useMemo(() => {
        return (pendingEmployees || [])
            .filter((emp) => Boolean(emp.expected_start_date))
            .map((emp) => {
                const relatedTodos = todosByPending[emp.id] || [];
                const isChecked = relatedTodos.length > 0 && relatedTodos.every((todo) => todo.status === 'completed');
                return {
                    ...emp,
                    isChecked,
                    beverageText: emp.beverage_drinks || '-'
                };
            })
            .sort((a, b) => {
                if (a.expected_start_date !== b.expected_start_date) {
                    return a.expected_start_date.localeCompare(b.expected_start_date);
                }
                return (a.seat_number || 9999) - (b.seat_number || 9999);
            });
    }, [pendingEmployees, todosByPending]);

    const hiresByDate = useMemo(() => {
        const grouped = {};
        hires.forEach((hire) => {
            if (!grouped[hire.expected_start_date]) grouped[hire.expected_start_date] = [];
            grouped[hire.expected_start_date].push(hire);
        });
        return grouped;
    }, [hires]);

    const calendarDays = useMemo(() => {
        const monthStart = startOfMonth(currentMonth);
        const monthEnd = endOfMonth(currentMonth);
        const rangeStart = startOfWeek(monthStart, { weekStartsOn: 0 });
        const rangeEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

        const days = [];
        let cursor = rangeStart;
        while (cursor <= rangeEnd) {
            days.push(cursor);
            cursor = addDays(cursor, 1);
        }
        return days;
    }, [currentMonth]);

    const calendarWeeks = useMemo(() => {
        const weeks = [];
        for (let i = 0; i < calendarDays.length; i += 7) {
            const weekDays = calendarDays.slice(i, i + 7);
            const maxHireCount = Math.max(
                0,
                ...weekDays.map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    return (hiresByDate[dateStr] || []).length;
                })
            );
            // No 신규 -> compact row, 1명 -> medium, 2명 이상 -> proportional growth.
            const rowHeight = 52 + (maxHireCount * 26);
            weeks.push({ weekDays, rowHeight });
        }
        return weeks;
    }, [calendarDays, hiresByDate]);

    const handleToggleChecked = async (hire) => {
        const relatedTodos = todosByPending[hire.id] || [];
        if (relatedTodos.length === 0) {
            alert('연결된 체크리스트가 없습니다.');
            return;
        }
        if (updatingIds.has(hire.id)) return;

        const nextDone = !hire.isChecked;
        const todoIds = relatedTodos.map((todo) => todo.id);
        const nowIso = new Date().toISOString();

        setUpdatingIds((prev) => new Set(prev).add(hire.id));
        try {
            const { error } = await supabase
                .from('staff_todos')
                .update({
                    status: nextDone ? 'completed' : 'pending',
                    completed_by: nextDone ? user?.id : null,
                    completed_at: nextDone ? nowIso : null
                })
                .in('id', todoIds);

            if (error) throw error;
            await fetchData();
        } catch (error) {
            console.error('Error updating new hire checklist:', error);
            alert('체크 상태 업데이트에 실패했습니다.');
        } finally {
            setUpdatingIds((prev) => {
                const next = new Set(prev);
                next.delete(hire.id);
                return next;
            });
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', display: 'flex', alignItems: 'center' }}>
                    <ChevronLeft size={24} color="#2d3748" />
                </button>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>신규 출근 일정</h3>
            </div>

            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <button
                        onClick={() => setCurrentMonth((prev) => subMonths(prev, 1))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}
                    >
                        <ChevronLeft size={20} color="#4a5568" />
                    </button>
                    <div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '1rem' }}>
                        {format(currentMonth, 'yyyy년 M월', { locale: ko })}
                    </div>
                    <button
                        onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}
                    >
                        <ChevronRight size={20} color="#4a5568" />
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '6px' }}>
                    {['일', '월', '화', '수', '목', '금', '토'].map((day) => (
                        <div key={day} style={{ textAlign: 'center', fontSize: '0.8rem', color: '#718096', fontWeight: 'bold' }}>
                            {day}
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {calendarWeeks.map((week, weekIndex) => (
                        <div key={`week_${weekIndex}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
                            {week.weekDays.map((day) => {
                                const dateStr = format(day, 'yyyy-MM-dd');
                                const dayHires = hiresByDate[dateStr] || [];
                                const isToday = isSameDay(day, new Date());

                                return (
                                    <div
                                        key={dateStr}
                                        style={{
                                            minHeight: `${week.rowHeight}px`,
                                            border: isToday ? '2px solid #267E82' : '1px solid #e2e8f0',
                                            borderRadius: '10px',
                                            padding: '4px',
                                            background: isSameMonth(day, currentMonth) ? 'white' : '#f7fafc'
                                        }}
                                    >
                                        <div style={{
                                            textAlign: 'right',
                                            fontSize: '0.75rem',
                                            color: isSameMonth(day, currentMonth) ? '#4a5568' : '#a0aec0',
                                            marginBottom: '3px'
                                        }}>
                                            {format(day, 'd')}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                            {dayHires.map((hire) => {
                                                const tone = getDateTone(dateStr, hire.isChecked);
                                                const seatText = hire.seat_number ? `${hire.seat_number}번` : '좌석미정';
                                                return (
                                                    <div
                                                        key={hire.id}
                                                        style={{
                                                            background: tone.bg,
                                                            border: `1px solid ${tone.border}`,
                                                            color: tone.text,
                                                            borderRadius: '6px',
                                                            padding: '2px 3px',
                                                            fontSize: '0.64rem',
                                                            fontWeight: 'bold',
                                                            lineHeight: 1.2,
                                                            whiteSpace: 'pre-line'
                                                        }}
                                                    >
                                                        {`${seatText}\n${hire.name}`}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '12px', marginBottom: '6px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#2d3748' }}>체크리스트</h4>
                {loading ? (
                    <div style={{ textAlign: 'center', color: '#a0aec0', padding: '16px 0' }}>불러오는 중...</div>
                ) : hires.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#a0aec0', padding: '18px 0' }}>신규 출근 예정자가 없습니다.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {hires.map((hire) => {
                            const tone = getDateTone(hire.expected_start_date, hire.isChecked);
                            const title = `${hire.seat_number ? `${hire.seat_number}번 ` : ''}${hire.name}`;
                            const plaqueText = hire.target_certificate || '-';

                            return (
                                <div
                                    key={hire.id}
                                    style={{
                                        border: `1px solid ${tone.border}`,
                                        background: tone.bg,
                                        borderRadius: '10px',
                                        padding: '10px'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                        <button
                                            onClick={() => handleToggleChecked(hire)}
                                            disabled={updatingIds.has(hire.id)}
                                            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: tone.text }}
                                        >
                                            {hire.isChecked ? <CheckSquare size={22} /> : <Square size={22} />}
                                        </button>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 'bold', color: '#2d3748', marginBottom: '6px' }}>{title}</div>
                                            <div style={{ fontSize: '0.9rem', color: '#4a5568', lineHeight: 1.45 }}>
                                                <div>입사일: {hire.expected_start_date}</div>
                                                <div>명패: {plaqueText}</div>
                                                <div>음료: {hire.beverageText}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StaffNewHireSchedule;
