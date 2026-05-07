import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';
import { BRANCH_OPTIONS } from '../constants/branches';
import { useAuth } from '../context/AuthContext';
import { Plus, Check, Trash2, AlertCircle, MessageCircle, Edit2, ChevronDown, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { appendManagerReplyToContent, buildContentWithReplies, parseContentWithReplies } from '../utils/replyContent';
import EmbeddedCalendar from '../components/EmbeddedCalendar';

const NEW_HIRE_NOTICE_DISMISS_PREFIX = '__NEW_HIRE_NOTICE_DISMISSED__';

const getKstTodayString = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const map = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    });

    return `${map.year}-${map.month}-${map.day}`;
};

const parseSideDishAmount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

const formatSideDishDateLabel = (dateStr) => {
    const [year, month, day] = String(dateStr || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    const date = new Date(year, month - 1, day);
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    return `${month}/${day}(${weekdays[date.getDay()]})`;
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
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

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
    if (normalizedItems.length === 0) {
        return [];
    }

    return [{
        batchId: 'legacy-batch-0',
        items: normalizedItems,
        submittedAt: fallbackSubmittedAt || null
    }];
};

const StaffTaskBoard = () => {
    const { user } = useAuth();
    const [view, setView] = useState(() => localStorage.getItem('staff_task_board_view') || 'tasks'); // 'tasks' | 'schedule'
    const [isAssignmentMode, setIsAssignmentMode] = useState(false); // Assignment mode for schedule
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newTodo, setNewTodo] = useState('');
    const [isUrgent, setIsUrgent] = useState(false);
    const [editingTask, setEditingTask] = useState(null);
    const [editContent, setEditContent] = useState('');
    const [replyingTask, setReplyingTask] = useState(null);
    const [replyContent, setReplyContent] = useState('');
    const [sideDishRequests, setSideDishRequests] = useState([]);
    const [isSideDishPopupOpen, setIsSideDishPopupOpen] = useState(false);
    const [kstToday, setKstToday] = useState(() => getKstTodayString());
    const [selectedSideDishDate, setSelectedSideDishDate] = useState(() => getKstTodayString());
    const [isSideDishCalendarOpen, setIsSideDishCalendarOpen] = useState(false);

    useEffect(() => {
        if (!isSideDishPopupOpen || typeof document === 'undefined') return undefined;

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [isSideDishPopupOpen]);

    useEffect(() => {
        if (!isSideDishPopupOpen) {
            setIsSideDishCalendarOpen(false);
        }
    }, [isSideDishPopupOpen]);

    useEffect(() => {
        const timer = setInterval(() => {
            setKstToday((prev) => {
                const now = getKstTodayString();
                return prev === now ? prev : now;
            });
        }, 30000);

        return () => clearInterval(timer);
    }, []);

    // Persist view
    useEffect(() => {
        localStorage.setItem('staff_task_board_view', view);
    }, [view]);

    // Branch configuration
    // Branch configuration
    const BASIC_BRANCHES = BRANCH_OPTIONS;

    // Sorted Branch List
    const branches = React.useMemo(() => {
        const userBranch = user?.branch || '';
        // 1. Combine and Deduplicate
        const all = new Set([...BASIC_BRANCHES]);
        if (userBranch && userBranch !== '미정') all.add(userBranch);

        // 2. Sort
        return Array.from(all).sort((a, b) => {
            // '전체' always first
            if (a === '전체') return -1;
            if (b === '전체') return 1;

            // User branch always second (right after '전체')
            if (a === userBranch) return -1;
            if (b === userBranch) return 1;

            // Others alphabetical
            return a.localeCompare(b);
        });
    }, [user?.branch]);

    // Initialize selection
    const [selectedBranch, setSelectedBranch] = useState(() => {
        if (user?.branch && user.branch !== '미정') return user.branch;
        return '전체';
    });

    // Update selected branch if user data updates
    useEffect(() => {
        if (user?.branch) {
            const target = (user.branch === '미정' || user.branch === '전체') ? '전체' : user.branch;
            setSelectedBranch(target);
        }
    }, [user?.branch]);

    // Fetch Data
    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Staff Todos
            const { data: todos, error: todoError } = await supabase
                .from('staff_todos')
                .select(`
                    *,
                    author:created_by ( name, branch ),
                    completer:completed_by ( name )
                `);

            if (todoError) throw todoError;

            // 2. Fetch Pending Registrations for "신규 있음" notices
            const { data: pendingRegs, error: pendingError } = await supabase
                .from('pending_registrations')
                .select('id, branch, expected_start_date')
                .is('linked_user_id', null);

            if (pendingError) throw pendingError;

            const { data: sideDishData, error: sideDishError } = await supabase
                .from('side_dish_requests')
                .select(`
                    id,
                    period,
                    items,
                    total_amount,
                    payment_completed,
                    submitted_at,
                    requester:user_id ( name, branch, seat_number )
                `)
                .eq('request_date', selectedSideDishDate)
                .order('submitted_at', { ascending: true });

            if (sideDishError) {
                console.warn('Side dish requests unavailable:', sideDishError.message);
                setSideDishRequests([]);
            } else {
                const normalizedSideDish = (sideDishData || [])
                    .filter((row) => row.payment_completed && row.submitted_at)
                    .map((row) => {
                        const normalizedBatches = normalizeSideDishBatches(row.items, row.submitted_at);
                        const normalizedItems = normalizedBatches.flatMap((batch) => batch.items);
                        const calculatedTotal = normalizedItems.reduce((sum, item) => sum + item.amount, 0);

                        return {
                            id: row.id,
                            period: row.period,
                            batches: normalizedBatches,
                            items: normalizedItems,
                            totalAmount: row.total_amount || calculatedTotal,
                            requesterName: row.requester?.name || '알수없음',
                            requesterBranch: row.requester?.branch || '알수없음',
                            seatNumber: row.requester?.seat_number || null,
                            submittedAt: row.submitted_at
                        };
                    });
                setSideDishRequests(normalizedSideDish);
            }

            const dismissedNoticeKeys = new Set(
                (todos || [])
                    .filter(t => !t.pending_registration_id && typeof t.content === 'string' && t.content.startsWith(NEW_HIRE_NOTICE_DISMISS_PREFIX))
                    .map(t => t.content.replace(`${NEW_HIRE_NOTICE_DISMISS_PREFIX}:`, '').trim())
            );

            // 4. Merge & Format
            const formattedTodos = (todos || [])
                .filter(t => !t.pending_registration_id && !(typeof t.content === 'string' && t.content.startsWith(NEW_HIRE_NOTICE_DISMISS_PREFIX)))
                .map((t) => {
                    const { body, replies } = parseContentWithReplies(t.content);
                    return {
                        ...t,
                        content: body,
                        replies,
                        type: 'staff',
                        authorName: t.author?.name || '알수없음',
                        branch: t.branch || t.author?.branch || '알수없음', // Use stored branch, fallback to author's current branch
                        completerName: t.completer?.name
                    };
                });

            const groupedNewHireByDate = {};
            (pendingRegs || []).forEach((reg) => {
                if (!reg.expected_start_date) return;
                const key = `${reg.branch || '알수없음'}_${reg.expected_start_date}`;
                if (!groupedNewHireByDate[key]) {
                    const shortDate = format(new Date(`${reg.expected_start_date}T00:00:00`), 'M/d');
                    groupedNewHireByDate[key] = {
                        id: key,
                        content: `${shortDate} 신규 있음`,
                        is_urgent: false,
                        created_at: `${reg.expected_start_date}T00:00:00`,
                        type: 'new_hire_notice',
                        authorName: '시스템',
                        branch: reg.branch || '알수없음',
                        completerName: null,
                        pendingIds: []
                    };
                }
                groupedNewHireByDate[key].pendingIds.push(reg.id);
            });

            const pendingTodos = (todos || []).filter(t => t.pending_registration_id);

            const newHireNotices = Object.values(groupedNewHireByDate)
                .filter((notice) => !dismissedNoticeKeys.has(`${notice.branch}_${notice.created_at.slice(0, 10)}`))
                .map((notice) => {
                    const pendingIdSet = new Set(notice.pendingIds);
                    const relatedTodos = pendingTodos.filter((t) => pendingIdSet.has(t.pending_registration_id));
                    const allCompleted = relatedTodos.length > 0 && relatedTodos.every((t) => t.status === 'completed');
                    return {
                        ...notice,
                        status: allCompleted ? 'completed' : 'pending',
                        pendingTodoIds: relatedTodos.map((t) => t.id)
                    };
                });

            setTasks([...newHireNotices, ...formattedTodos]);
        } catch (error) {
            console.error('Error fetching tasks:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [kstToday, selectedSideDishDate]);

    // Add Staff Todo
    const handleAddTodo = async () => {
        if (selectedBranch === '전체') {
            alert('지점을 선택 후 할 일을 입력해주세요.');
            return;
        }
        if (!newTodo.trim()) return;
        try {
            const targetBranch = selectedBranch === '전체' ? user.branch : selectedBranch;
            const { error } = await supabase
                .from('staff_todos')
                .insert([{
                    content: newTodo,
                    is_urgent: isUrgent,
                    created_by: user.id,
                    branch: targetBranch // Save the target branch
                }]);

            if (error) throw error;

            setNewTodo('');
            setIsUrgent(false);
            fetchData();
        } catch (error) {
            console.error('Error adding todo:', error);
            alert(`투두 추가 실패: ${error.message || error.details || JSON.stringify(error)}`);
        }
    };

    // Toggle Complete
    const handleToggleComplete = async (task) => {
        try {
            if (task.type === 'new_hire_notice') {
                if (!task.pendingIds || task.pendingIds.length === 0) {
                    alert('연결된 신규 체크리스트가 없습니다.');
                    return;
                }

                const newStatus = task.status === 'completed' ? 'pending' : 'completed';
                const completedBy = newStatus === 'completed' ? user.id : null;
                const completedAt = newStatus === 'completed' ? new Date().toISOString() : null;

                const { error } = await supabase
                    .from('staff_todos')
                    .update({
                        status: newStatus,
                        completed_by: completedBy,
                        completed_at: completedAt
                    })
                    .in('pending_registration_id', task.pendingIds);

                if (error) throw error;
                fetchData();
                return;
            }

            if (task.type === 'staff') {
                const newStatus = task.status === 'completed' ? 'pending' : 'completed';
                const completedBy = newStatus === 'completed' ? user.id : null;
                const completedAt = newStatus === 'completed' ? new Date().toISOString() : null;

                const { error } = await supabase
                    .from('staff_todos')
                    .update({
                        status: newStatus,
                        completed_by: completedBy,
                        completed_at: completedAt
                    })
                    .eq('id', task.id);
                if (error) throw error;
            }
            fetchData();
        } catch (error) {
            console.error('Error updating task:', error);
            alert('상태 업데이트 실패');
        }
    };

    // Delete Task
    const handleDelete = async (task) => {
        if (!confirm('정말 삭제하시겠습니까?')) return;

        // Permission Check
        // Permission Check
        const isAdmin = user.role === 'admin' || user.role === 'manager';

        let canDelete = false;

        // Admin overrides all
        if (isAdmin) {
            canDelete = true;
        } else if (task.type === 'staff') {
            // Staff can only delete their own pending tasks
            if (task.status === 'pending' && task.created_by === user.id) canDelete = true;
        } else if (task.type === 'new_hire_notice') {
            canDelete = true;
        }

        if (!canDelete) {
            console.log('Delete permission denied:', { role: user.role, type: task.type, status: task.status, creator: task.created_by, userId: user.id });
            alert('삭제 권한이 없습니다.');
            return;
        }

        try {
            if (task.type === 'new_hire_notice') {
                const marker = `${NEW_HIRE_NOTICE_DISMISS_PREFIX}:${task.branch}_${task.created_at.slice(0, 10)}`;
                const { error } = await supabase
                    .from('staff_todos')
                    .insert({
                        content: marker,
                        is_urgent: false,
                        status: 'completed',
                        created_by: user.id,
                        branch: task.branch
                    });
                if (error) throw error;
            } else {
                const { error } = await supabase.from('staff_todos').delete().eq('id', task.id);
                if (error) throw error;
            }
            fetchData();
        } catch (error) {
            console.error('Error deleting task:', error);
            alert(`삭제 실패: ${error.message || error.details || JSON.stringify(error)}`);
        }
    };

    // Edit Task
    const handleEdit = async (task) => {
        if (!editContent.trim()) return;
        try {
            const nextContent = buildContentWithReplies({
                body: editContent,
                replies: task.replies || []
            });
            const { error } = await supabase
                .from('staff_todos')
                .update({ content: nextContent })
                .eq('id', task.id);
            if (error) throw error;
            setEditingTask(null);
            setEditContent('');
            fetchData();
        } catch (error) {
            console.error('Error editing task:', error);
            alert(`수정 실패: ${error.message || error.details || JSON.stringify(error)}`);
        }
    };

    // Start Edit Mode
    const startEdit = (task) => {
        setEditingTask(task);
        setEditContent(task.content);
        setReplyingTask(null);
        setReplyContent('');
    };

    const getTaskKey = (task) => `${task.type}-${task.id}`;

    const toggleReplyInput = (task) => {
        const key = getTaskKey(task);
        if (replyingTask === key) {
            setReplyingTask(null);
            setReplyContent('');
            return;
        }

        setEditingTask(null);
        setEditContent('');
        setReplyingTask(key);
        setReplyContent('');
    };

    const handleReplySave = async (task) => {
        if (!replyContent.trim()) return;
        try {
            const currentContent = buildContentWithReplies({
                body: task.content,
                replies: task.replies || []
            });
            const nextContent = appendManagerReplyToContent({
                content: currentContent,
                replyText: replyContent,
                authorName: user?.name || '관리자'
            });

            const { error } = await supabase
                .from('staff_todos')
                .update({ content: nextContent })
                .eq('id', task.id);
            if (error) throw error;

            setReplyingTask(null);
            setReplyContent('');
            fetchData();
        } catch (error) {
            console.error('Error saving reply:', error);
            alert(`답글 저장 실패: ${error.message || error.details || JSON.stringify(error)}`);
        }
    };

    // Sorting & Filtering
    const sortedTasks = [...tasks]
        .filter(task => {
            if (selectedBranch === '전체') return true;
            return task.branch === selectedBranch;
        })
        .sort((a, b) => {
            // 1. Pending First
            if (a.status !== b.status) {
                return a.status === 'pending' ? -1 : 1;
            }

            // 2. Inside Pending: Urgent(Red) > Suggestion(Green) > Normal(Blue)
            if (a.status === 'pending') {
                const getPriority = (t) => {
                    if (t.type === 'staff' && t.is_urgent) return 3;
                    if (t.type === 'new_hire_notice') return 2;
                    return 1;
                };
                const pA = getPriority(a);
                const pB = getPriority(b);
                if (pA !== pB) return pB - pA; // Higher priority first
            }

            // 3. Oldest First (created_at ASC)
            return new Date(a.created_at) - new Date(b.created_at);
        });

    const sideDishSummary = React.useMemo(() => {
        const filtered = sideDishRequests
            .filter((request) => selectedBranch === '전체' || request.requesterBranch === selectedBranch)
            .sort((a, b) => new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0));

        const normalizePeriodItems = (period) => {
            const rows = [];
            filtered
                .filter((request) => request.period === period)
                .forEach((request) => {
                    request.items.forEach((item) => {
                        const name = String(item?.name || '').trim();
                        const amount = parseSideDishAmount(item?.amount);
                        if (!name || amount <= 0) return;

                        rows.push({
                            dishName: name,
                            amount,
                            requesterName: request.requesterName
                        });
                    });
                });
            return rows;
        };

        const am = normalizePeriodItems('am');
        const pm = normalizePeriodItems('pm');

        return {
            am,
            pm,
            hasAny: am.length > 0 || pm.length > 0
        };
    }, [selectedBranch, sideDishRequests]);

    const formatWon = (amount) => `${Number(amount || 0).toLocaleString('ko-KR')}원`;
    const sideDishDateLabel = formatSideDishDateLabel(selectedSideDishDate);


    // Render Helper
    const getTaskStyle = (task) => {
        if (task.status === 'completed') {
            return { borderColor: '#e2e8f0', bg: '#f8fafc', text: '#718096' }; // Darker gray for completed
        }
        if (task.type === 'new_hire_notice') {
            return { borderColor: '#f6e05e', bg: '#fffbeb', text: '#975a16' }; // Yellow
        }
        if (task.type === 'staff' && task.is_urgent) {
            return { borderColor: '#feb2b2', bg: '#fff5f5', text: '#c53030' }; // Red
        }
        return { borderColor: '#bee3f8', bg: '#ebf8ff', text: '#2c5282' }; // Blue
    };

    // Check Delete/Edit Permission Helper (same rules)
    const canUserModify = (task) => {
        if (task.type === 'new_hire_notice') return false;
        const isAdmin = user.role === 'admin' || user.role === 'manager';
        if (isAdmin) return true;

        // Staff can only edit/delete their own pending tasks
        if (task.type === 'staff' && task.status === 'pending' && task.created_by === user.id) {
            return true;
        }
        return false;
    };

    const canUserReply = (task) => {
        if (task.type === 'new_hire_notice') return false;
        return user.role === 'admin' || user.role === 'manager';
    };

    const formatReplyTime = (createdAt) => {
        if (!createdAt) return '';
        const date = new Date(createdAt);
        return date.toLocaleString('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const renderSideDishPeriodList = (title, list) => (
        <div style={{
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '10px',
            background: '#f8fafc'
        }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#1f2937', marginBottom: '8px' }}>
                {title}
            </div>
            {list.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>신청 없음</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {list.map((item, index) => (
                        <div key={`${title}-${index}-${item.requesterName}`} style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.35 }}>
                            {index + 1}. {item.dishName} {formatWon(item.amount)} {item.requesterName}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    const sideDishPopup = (isSideDishPopupOpen && typeof document !== 'undefined')
        ? createPortal(
            <div
                onClick={(e) => {
                    if (e.target === e.currentTarget) {
                        setIsSideDishPopupOpen(false);
                    }
                }}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: '12px'
                }}
            >
                <div
                    style={{
                        width: 'min(560px, calc(100vw - 24px))',
                        maxHeight: 'calc(100dvh - 24px)',
                        overflowY: 'auto',
                        background: 'white',
                        borderRadius: '14px',
                        border: '1px solid #e2e8f0',
                        padding: '14px',
                        position: 'relative'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <div style={{ fontSize: '0.95rem', fontWeight: '800', color: '#1e293b' }}>반찬신청 목록</div>
                            <button
                                type="button"
                                onClick={() => setIsSideDishCalendarOpen((prev) => !prev)}
                                style={{
                                    border: '1px solid #cbd5e0',
                                    background: '#f8fafc',
                                    color: '#334155',
                                    borderRadius: '8px',
                                    padding: '5px 9px',
                                    fontSize: '0.78rem',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                }}
                            >
                                <Calendar size={14} />
                                {sideDishDateLabel || selectedSideDishDate}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsSideDishPopupOpen(false)}
                            style={{
                                border: '1px solid #cbd5e0',
                                background: 'white',
                                color: '#475569',
                                borderRadius: '8px',
                                padding: '4px 8px',
                                fontSize: '0.78rem',
                                fontWeight: '700',
                                cursor: 'pointer'
                            }}
                        >
                            닫기
                        </button>
                    </div>

                    {isSideDishCalendarOpen && (
                        <div style={{
                            position: 'absolute',
                            top: '52px',
                            left: '14px',
                            zIndex: 2,
                            width: 'min(320px, calc(100% - 28px))',
                            background: 'white',
                            border: '1px solid #dbe4ee',
                            borderRadius: '12px',
                            padding: '8px',
                            boxShadow: '0 18px 30px rgba(15, 23, 42, 0.14)'
                        }}>
                            <EmbeddedCalendar
                                selectedDate={selectedSideDishDate}
                                onSelectDate={(dateStr) => {
                                    setSelectedSideDishDate(dateStr);
                                    setIsSideDishCalendarOpen(false);
                                }}
                                compact={true}
                                showEvents={false}
                            />
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {renderSideDishPeriodList('오전 반찬 신청', sideDishSummary.am)}
                        {renderSideDishPeriodList('오후 반찬 신청', sideDishSummary.pm)}
                    </div>
                </div>
            </div>,
            document.body
        )
        : null;

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px' }}>
            {/* Header Controls: Branch + View Toggle */}
            <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                marginBottom: '15px'
            }}>
                {/* Compact Branch Filter Dropdown (No Label) */}
                <div style={{ position: 'relative', flex: '1 1 120px', minWidth: '120px', maxWidth: '220px' }}>
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        style={{
                            width: '100%',
                            height: '34px', // Reduced height
                            padding: '0 28px 0 12px',
                            borderRadius: '10px', // Slightly smaller radius
                            border: '1px solid #e2e8f0',
                            backgroundColor: 'white',
                            color: '#4a5568',
                            fontSize: '0.9rem', // Reduced font size
                            fontWeight: '600',
                            appearance: 'none',
                            cursor: 'pointer',
                            outline: 'none',
                        }}
                    >
                        {branches.map(branch => (
                            <option key={branch} value={branch}>
                                {branch === '전체' ? '전체 지점' : branch}
                            </option>
                        ))}
                    </select>
                    <div style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                        color: '#718096',
                        display: 'flex',
                        alignItems: 'center'
                    }}>
                        <ChevronDown size={14} />
                    </div>
                </div>

                {/* Main Action Group (Right Aligned) */}
                <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' }}>
                    {/* Assignment Mode Toggle - Only shown in schedule view for admins */}
                    {view === 'schedule' && user.role === 'admin' && (
                        <button
                            onClick={() => setIsAssignmentMode(!isAssignmentMode)}
                            style={{
                                minWidth: '98px',
                                height: '34px',
                                padding: '0 10px',
                                borderRadius: '10px',
                                border: '1px solid #e2e8f0',
                                backgroundColor: isAssignmentMode ? 'var(--color-primary)' : 'white',
                                color: isAssignmentMode ? 'white' : '#4a5568',
                                fontSize: '0.85rem',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            <Edit2 size={14} />
                            {isAssignmentMode ? '배정 완료' : '근무 배정'}
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (!sideDishSummary.hasAny) return;
                            setIsSideDishPopupOpen(true);
                        }}
                        disabled={!sideDishSummary.hasAny}
                        style={{
                            minWidth: '108px',
                            height: '34px',
                            padding: '0 10px',
                            borderRadius: '10px',
                            border: `1px solid ${sideDishSummary.hasAny ? '#15803d' : '#cbd5e0'}`,
                            backgroundColor: sideDishSummary.hasAny ? '#22c55e' : '#e2e8f0',
                            color: sideDishSummary.hasAny ? 'white' : '#64748b',
                            fontSize: '0.82rem',
                            fontWeight: '700',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: sideDishSummary.hasAny ? 'pointer' : 'not-allowed',
                            transition: 'all 0.2s',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {sideDishSummary.hasAny ? '반찬신청 있음' : '반찬신청 없음'}
                    </button>

                    {/* View Toggle Button */}
                    <button
                        onClick={() => {
                            setView(view === 'tasks' ? 'schedule' : 'tasks');
                            if (view === 'tasks') setIsAssignmentMode(false);
                            setIsSideDishPopupOpen(false);
                        }}
                        style={{
                            minWidth: '98px',
                            height: '34px',
                            padding: '0 10px',
                            borderRadius: '10px',
                            border: '1px solid #e2e8f0',
                            backgroundColor: 'white',
                            color: '#4a5568',
                            fontSize: '0.85rem',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {view === 'schedule' ? <MessageCircle size={16} /> : <Calendar size={16} />}
                        {view === 'schedule' ? '업무 보기' : '근무표 보기'}
                    </button>
                </div>
            </div>

            {view === 'tasks' ? (
                <>
                    {/* Add Todo Input */}
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                        {/* ... (rest of the input code) */}
                        <div style={{ position: 'relative', flex: 1 }}>
                            <input
                                type="text"
                                value={newTodo}
                                onChange={(e) => setNewTodo(e.target.value)}
                                placeholder={selectedBranch === '전체' ? '지점 선택 후 할 일을 입력하여 주세요' : '할 일을 입력하세요...'}
                                disabled={selectedBranch === '전체'}
                                style={{
                                    width: '100%',
                                    padding: '12px 15px',
                                    paddingRight: '80px',
                                    borderRadius: '12px',
                                    border: `2px solid ${isUrgent ? '#feb2b2' : '#e2e8f0'}`,
                                    outline: 'none',
                                    transition: 'all 0.2s',
                                    fontSize: '1rem',
                                    backgroundColor: selectedBranch === '전체' ? '#f7fafc' : 'white',
                                    cursor: selectedBranch === '전체' ? 'not-allowed' : 'text'
                                }}
                            />
                            <div
                                onClick={() => setIsUrgent(!isUrgent)}
                                style={{
                                    position: 'absolute',
                                    right: '10px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    cursor: 'pointer',
                                    padding: '4px 8px',
                                    borderRadius: '20px',
                                    background: isUrgent ? '#c53030' : '#edf2f7',
                                    color: isUrgent ? 'white' : '#718096',
                                    fontSize: '0.8rem',
                                    fontWeight: 'bold',
                                    userSelect: 'none'
                                }}
                            >
                                <AlertCircle size={14} />
                                긴급
                            </div>
                        </div>
                        <button
                            onClick={handleAddTodo}
                            disabled={selectedBranch === '전체'}
                            style={{
                                padding: '0 16px',
                                borderRadius: '12px',
                                background: selectedBranch === '전체' ? '#cbd5e0' : 'var(--color-primary)',
                                color: 'white',
                                border: 'none',
                                cursor: selectedBranch === '전체' ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            <Plus size={24} />
                        </button>
                    </div>

                    {/* Task List */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {loading ? (
                            <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '20px' }}>로딩중...</div>
                        ) : sortedTasks.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '20px' }}>
                                {selectedBranch === '전체' ? '등록된 업무가 없습니다.' : `${selectedBranch}의 업무가 없습니다.`}
                            </div>
                        ) : (
                            sortedTasks.map(task => {
                                const style = getTaskStyle(task);
                                const isNotice = task.type === 'new_hire_notice';
                                const isCompleted = task.status === 'completed';
                                const canModify = canUserModify(task);
                                const canReply = canUserReply(task);
                                const isEditing = editingTask?.id === task.id && editingTask?.type === task.type;
                                const taskKey = getTaskKey(task);
                                const isReplying = replyingTask === taskKey;
                                const hasReplies = Array.isArray(task.replies) && task.replies.length > 0;

                                return (
                                    <div
                                        key={taskKey}
                                        style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            padding: '8px 10px',
                                            borderRadius: '12px',
                                            border: `1px solid ${style.borderColor}`,
                                            backgroundColor: style.bg,
                                            transition: 'all 0.2s',
                                            gap: '8px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                            {/* Checkbox */}
                                            <div
                                                onClick={() => handleToggleComplete(task)}
                                                style={{
                                                    minWidth: '20px',
                                                    height: '20px',
                                                    borderRadius: '5px',
                                                    border: `2px solid ${isCompleted ? '#cbd5e0' : style.text}`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    cursor: 'pointer',
                                                    flexShrink: 0,
                                                    backgroundColor: isCompleted ? '#cbd5e0' : 'white'
                                                }}
                                            >
                                                {isCompleted && <Check size={12} color="white" />}
                                            </div>

                                            {/* Content - flexible width, wraps when needed */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                {isEditing ? (
                                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <input
                                                            type="text"
                                                            value={editContent}
                                                            onChange={(e) => setEditContent(e.target.value)}
                                                            autoFocus
                                                            style={{
                                                                flex: 1,
                                                                minWidth: '150px',
                                                                padding: '4px 8px',
                                                                borderRadius: '6px',
                                                                border: '1px solid #cbd5e0',
                                                                fontSize: '0.9rem'
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleEdit(task);
                                                                if (e.key === 'Escape') { setEditingTask(null); setEditContent(''); }
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => handleEdit(task)}
                                                            style={{ padding: '3px 8px', borderRadius: '5px', background: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}
                                                        >저장</button>
                                                        <button
                                                            onClick={() => { setEditingTask(null); setEditContent(''); }}
                                                            style={{ padding: '3px 8px', borderRadius: '5px', background: '#e2e8f0', color: '#4a5568', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}
                                                        >취소</button>
                                                    </div>
                                                ) : (
                                                    <div style={{
                                                        fontSize: '0.9rem',
                                                        color: isCompleted ? '#718096' : '#2d3748',
                                                        textDecoration: isCompleted ? 'line-through' : 'none',
                                                        wordBreak: 'break-word',
                                                        lineHeight: '1.4'
                                                    }}>
                                                        {task.content}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Right side: Author + Action Buttons */}
                                            {!isEditing && (
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    flexShrink: 0,
                                                    marginLeft: 'auto'
                                                }}>
                                                    {/* Author Info */}
                                                    <span style={{
                                                        fontSize: '0.7rem',
                                                        color: isCompleted ? '#a0aec0' : style.text,
                                                        opacity: 0.8,
                                                        whiteSpace: 'nowrap'
                                                    }}>
                                                        {`작성:${task.authorName}`}
                                                        {task.completerName && ` /완료:${task.completerName}`}
                                                    </span>

                                                    {/* Action Buttons */}
                                                    {isNotice ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleDelete(task); }}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                color: isCompleted ? '#a0aec0' : '#e53e3e',
                                                                cursor: 'pointer',
                                                                padding: '2px',
                                                                opacity: 0.6
                                                            }}
                                                            onMouseOver={(e) => e.currentTarget.style.opacity = 1}
                                                            onMouseOut={(e) => e.currentTarget.style.opacity = 0.6}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    ) : (
                                                        <>
                                                            {canReply && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); toggleReplyInput(task); }}
                                                                    style={{
                                                                        border: '1px solid #cbd5e0',
                                                                        background: isReplying ? '#edf2f7' : 'white',
                                                                        color: '#4a5568',
                                                                        cursor: 'pointer',
                                                                        padding: '2px 6px',
                                                                        borderRadius: '999px',
                                                                        fontSize: '0.72rem',
                                                                        fontWeight: '700'
                                                                    }}
                                                                >
                                                                    답글
                                                                </button>
                                                            )}
                                                            {canModify && (
                                                                <>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); startEdit(task); }}
                                                                        style={{
                                                                            background: 'none',
                                                                            border: 'none',
                                                                            color: isCompleted ? '#a0aec0' : '#3182ce',
                                                                            cursor: 'pointer',
                                                                            padding: '2px',
                                                                            opacity: 0.6
                                                                        }}
                                                                        onMouseOver={(e) => e.currentTarget.style.opacity = 1}
                                                                        onMouseOut={(e) => e.currentTarget.style.opacity = 0.6}
                                                                    >
                                                                        <Edit2 size={14} />
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleDelete(task); }}
                                                                        style={{
                                                                            background: 'none',
                                                                            border: 'none',
                                                                            color: isCompleted ? '#a0aec0' : '#e53e3e',
                                                                            cursor: 'pointer',
                                                                            padding: '2px',
                                                                            opacity: 0.6
                                                                        }}
                                                                        onMouseOver={(e) => e.currentTarget.style.opacity = 1}
                                                                        onMouseOut={(e) => e.currentTarget.style.opacity = 0.6}
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {hasReplies && (
                                            <div style={{ marginLeft: '28px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {task.replies.map((reply) => (
                                                    <div
                                                        key={reply.id}
                                                        style={{
                                                            background: 'white',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '10px',
                                                            padding: '8px 10px'
                                                        }}
                                                    >
                                                        <div style={{ fontSize: '0.72rem', color: '#718096', marginBottom: '4px' }}>
                                                            답글 · {reply.authorName} · {formatReplyTime(reply.createdAt)}
                                                        </div>
                                                        <div style={{ fontSize: '0.84rem', color: '#2d3748', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                            {reply.text}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {isReplying && (
                                            <div
                                                style={{
                                                    marginLeft: '28px',
                                                    background: 'white',
                                                    border: '1px solid #e2e8f0',
                                                    borderRadius: '10px',
                                                    padding: '10px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '8px'
                                                }}
                                            >
                                                <textarea
                                                    value={replyContent}
                                                    onChange={(e) => setReplyContent(e.target.value)}
                                                    placeholder="답변을 입력하세요..."
                                                    rows={3}
                                                    autoFocus
                                                    style={{
                                                        width: '100%',
                                                        resize: 'vertical',
                                                        border: '1px solid #cbd5e0',
                                                        borderRadius: '8px',
                                                        padding: '8px',
                                                        fontSize: '0.88rem',
                                                        fontFamily: 'inherit',
                                                        boxSizing: 'border-box'
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            handleReplySave(task);
                                                        }
                                                    }}
                                                />
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                                    <button
                                                        onClick={() => handleReplySave(task)}
                                                        style={{
                                                            padding: '6px 10px',
                                                            borderRadius: '6px',
                                                            border: 'none',
                                                            background: 'var(--color-primary)',
                                                            color: 'white',
                                                            fontSize: '0.8rem',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        저장
                                                    </button>
                                                    <button
                                                        onClick={() => { setReplyingTask(null); setReplyContent(''); }}
                                                        style={{
                                                            padding: '6px 10px',
                                                            borderRadius: '6px',
                                                            border: '1px solid #cbd5e0',
                                                            background: 'white',
                                                            color: '#4a5568',
                                                            fontSize: '0.8rem',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        취소
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </>
            ) : (
                <StaffWorkSchedule
                    branch={selectedBranch}
                    isAdmin={user.role === 'admin'}
                    isAssignmentMode={isAssignmentMode}
                    setIsAssignmentMode={setIsAssignmentMode}
                />
            )}

            {sideDishPopup}
        </div>
    );
};

// --- Sub-Components ---

const StaffWorkSchedule = ({ branch, isAdmin, isAssignmentMode, setIsAssignmentMode }) => {
    const [schedules, setSchedules] = useState([]);
    const [staffList, setStaffList] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        if (branch === '전체') return;
        setLoading(true);
        try {
            // 1. Fetch users with role 'staff' from authorized_users FOR THIS BRANCH
            const { data: staffData, error: staffError } = await supabase
                .from('authorized_users')
                .select('name')
                .eq('role', 'staff')
                .eq('branch', branch)
                .order('name', { ascending: true });

            if (staffError) throw staffError;
            setStaffList(staffData?.map(s => s.name) || []);

            // 2. Fetch Weekly Schedule for this branch
            const { data: scheduleData, error: scheduleError } = await supabase
                .from('staff_schedules')
                .select('*')
                .eq('branch', branch);

            if (scheduleError) throw scheduleError;
            setSchedules(scheduleData || []);
        } catch (err) {
            console.error('Error fetching schedule:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        // Real-time subscription for StaffWorkSchedule
        const scheduleChannel = supabase
            .channel('staff_schedules_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'staff_schedules',
                filter: `branch=eq.${branch}`
            }, () => {
                fetchData();
            })
            .subscribe();

        return () => {
            scheduleChannel.unsubscribe();
        };
    }, [branch]);

    const handleUpdateAssignment = async (day, shift, role, name) => {
        if (!isAdmin) return;
        try {
            const { error } = await supabase
                .from('staff_schedules')
                .upsert({
                    branch,
                    day_of_week: day,
                    shift,
                    role,
                    staff_name: name,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'branch,day_of_week,shift,role' });

            if (error) throw error;
            fetchData();
        } catch (err) {
            alert('배정 저장 실패');
            console.error(err);
        }
    };

    const days = ['월', '화', '수', '목', '금'];
    const shifts = [
        { key: 'morning', label: '오전', roles: [{ key: 'dish', label: '설거지' }, { key: 'sub', label: '서브' }] },
        { key: 'afternoon', label: '오후', roles: [{ key: 'dish', label: '설거지' }, { key: 'sub', label: '서브' }] }
    ];

    if (branch === '전체') {
        return <div style={{ textAlign: 'center', marginTop: '50px', color: '#718096' }}>지점을 선택하면 근무표를 볼 수 있습니다.</div>;
    }

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Compact Table Container - No Scroll */}
            <div style={{
                background: 'white',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '5px',
                overflowX: 'auto',
                overflowY: 'hidden'
            }}>
                <table style={{
                    width: '100%',
                    minWidth: '560px',
                    borderCollapse: 'collapse',
                    fontSize: '0.7rem', // Smaller font to fit
                    tableLayout: 'fixed' // Force columns to fit width
                }}>
                    <thead>
                        <tr>
                            <th style={{ width: '12%', padding: '8px 2px', borderBottom: '2px solid #edf2f7', borderRight: '1px solid #edf2f7', wordBreak: 'keep-all' }}>시간</th>
                            <th style={{ width: '15%', padding: '8px 2px', borderBottom: '2px solid #edf2f7', borderRight: '1px solid #edf2f7', wordBreak: 'keep-all' }}>업무</th>
                            {days.map(d => (
                                <th key={d} style={{ padding: '8px 0', borderBottom: '2px solid #edf2f7', backgroundColor: '#f8fafc' }}>{d}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {shifts.map((s, sIdx) => (
                            <React.Fragment key={s.key}>
                                {s.roles.map((r, rIdx) => (
                                    <tr key={`${s.key}-${r.key}`}>
                                        {rIdx === 0 && (
                                            <td rowSpan={2} style={{
                                                textAlign: 'center',
                                                fontWeight: 'bold',
                                                borderRight: '1px solid #edf2f7',
                                                borderBottom: sIdx === 0 ? '2px solid #edf2f7' : 'none',
                                                backgroundColor: '#f8fafc',
                                                verticalAlign: 'middle'
                                            }}>
                                                {s.label}
                                            </td>
                                        )}
                                        <td style={{
                                            textAlign: 'center',
                                            padding: '4px 0',
                                            borderRight: '1px solid #edf2f7',
                                            color: '#718096',
                                            borderBottom: rIdx === 0 ? '1px solid #f7fafc' : (sIdx === 0 ? '2px solid #edf2f7' : 'none'),
                                            verticalAlign: 'middle'
                                        }}>
                                            {r.label}
                                        </td>
                                        {days.map((_, dIdx) => {
                                            const assignment = schedules.find(as => as.day_of_week === dIdx && as.shift === s.key && as.role === r.key);
                                            const hasName = assignment?.staff_name && assignment.staff_name !== '미지정';

                                            return (
                                                <td key={dIdx} style={{
                                                    padding: '2px',
                                                    borderBottom: rIdx === 0 ? '1px solid #f7fafc' : (sIdx === 0 ? '2px solid #edf2f7' : 'none'),
                                                    textAlign: 'center',
                                                    verticalAlign: 'middle'
                                                }}>
                                                    {isAssignmentMode ? (
                                                        <select
                                                            value={assignment?.staff_name || '미지정'}
                                                            onChange={(e) => handleUpdateAssignment(dIdx, s.key, r.key, e.target.value)}
                                                            style={{
                                                                width: '100%',
                                                                padding: '4px 0',
                                                                borderRadius: '4px',
                                                                border: '1px solid #e2e8f0',
                                                                fontSize: '0.7rem',
                                                                backgroundColor: hasName ? '#ebf8ff' : '#f8fafc',
                                                                color: hasName ? '#2b6cb0' : '#a0aec0',
                                                                cursor: 'pointer',
                                                                outline: 'none',
                                                                textAlign: 'center',
                                                                textIndent: '2px'
                                                            }}
                                                        >
                                                            <option value="미지정">-</option>
                                                            {staffList.map(name => (
                                                                <option key={name} value={name}>{name}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <div style={{
                                                            fontSize: '0.7rem', // Consistent small font
                                                            fontWeight: hasName ? 'bold' : 'normal',
                                                            color: hasName ? '#2b6cb0' : '#e2e8f0', // Lighter color for empty dash
                                                            padding: '4px 0',
                                                            whiteSpace: 'normal', // Allow wrap if really tight
                                                            wordBreak: 'keep-all', // Try not to break words if possible
                                                            lineHeight: '1.2'
                                                        }}>
                                                            {hasName ? assignment.staff_name : '-'}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default StaffTaskBoard;
