import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import EmbeddedCalendar from './EmbeddedCalendar';

const DEADLINE_LIMIT_DISABLED = false;
const COUPANG_EATS_LINK = 'https://web.coupangeats.com/share?storeId=636864&dishId&key=b29e27b7-ff7a-4d28-952a-ef42687665c0';
const ACCOUNT_TRANSFER_INFO = '신한 110-498-435650 김지원';

const createEmptyRequestState = () => ({
    items: [],
    paymentCompleted: false
});

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

    const map = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    });

    return {
        dateStr: `${map.year}-${map.month}-${map.day}`,
        hour: Number(map.hour || 0),
        minute: Number(map.minute || 0)
    };
};

const formatPanelDateLabel = (dateStr) => {
    const [year, month, day] = String(dateStr || '').split('-').map(Number);
    const safeDate = new Date(year, (month || 1) - 1, day || 1);
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    return `${month}/${day}(${weekdays[safeDate.getDay()]})`;
};

const getDeadlineInfo = (period, nowParts, selectedDate) => {
    const isSelectedDateToday = selectedDate === nowParts.dateStr;

    if (period === 'am') {
        const closed = DEADLINE_LIMIT_DISABLED
            ? false
            : isSelectedDateToday && (nowParts.hour > 10 || (nowParts.hour === 10 && nowParts.minute >= 45));
        return { closed, text: '당일 10:45AM 마감', closedMessage: '점심 반찬 신청 마감' };
    }

    const closed = DEADLINE_LIMIT_DISABLED
        ? false
        : isSelectedDateToday && (nowParts.hour > 16 || (nowParts.hour === 16 && nowParts.minute >= 30));
    return { closed, text: '당일 16:30PM 마감', closedMessage: '저녁 반찬 신청 마감' };
};

const parseAmount = (value) => {
    const numeric = String(value ?? '').replace(/[^0-9]/g, '');
    const amount = parseInt(numeric, 10);
    return Number.isFinite(amount) ? amount : 0;
};

const formatAmount = (value) => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const PRIVILEGED_ROLES = new Set(['staff', 'admin', 'manager']);
const createEmptySubmittedOrders = () => ({ am: null, pm: null });

const formatSubmittedAt = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
};

const summarizeFactoryTotals = (rows) => {
    const nextTotals = { am: 0, pm: 0 };
    (rows || []).forEach((row) => {
        const period = row.period === 'pm' ? 'pm' : 'am';
        let rowTotal = parseAmount(row.total_amount);
        if (rowTotal <= 0 && Array.isArray(row.items)) {
            rowTotal = row.items.reduce((sum, item) => sum + parseAmount(item?.amount), 0);
        }
        nextTotals[period] += rowTotal;
    });
    return nextTotals;
};

const cardStyle = {
    background: 'white',
    borderRadius: '16px',
    padding: '18px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    height: '100%',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none'
};

const panelStyle = (isClosed) => ({
    border: `1px solid ${isClosed ? '#d1d5db' : '#d9e2ec'}`,
    borderRadius: '14px',
    padding: '12px',
    background: isClosed ? '#f3f4f6' : '#f8fafc',
    opacity: isClosed ? 0.9 : 1
});

const modalOverlayStyle = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.52)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '12px',
    overflowY: 'auto',
    zIndex: 10000
};

const modalCardStyle = {
    width: 'min(460px, calc(100vw - 24px))',
    boxSizing: 'border-box',
    maxHeight: 'calc(100vh - 24px)',
    overflowY: 'auto',
    background: 'white',
    borderRadius: '14px',
    padding: '14px',
    boxShadow: '0 18px 36px rgba(15, 23, 42, 0.28)'
};

const InlineSideDishRequest = () => {
    const { user } = useAuth();
    const [nowTick, setNowTick] = useState(Date.now());
    const [loading, setLoading] = useState(true);
    const [savingPeriod, setSavingPeriod] = useState('');
    const [factoryTotals, setFactoryTotals] = useState({ am: 0, pm: 0 });
    const [calendarEvents, setCalendarEvents] = useState([]);

    const nowParts = useMemo(() => getKstNowParts(nowTick), [nowTick]);
    const todayKst = nowParts.dateStr;
    const [selectedDate, setSelectedDate] = useState(() => todayKst);

    const [amRequest, setAmRequest] = useState(createEmptyRequestState());
    const [pmRequest, setPmRequest] = useState(createEmptyRequestState());
    const [mySubmittedOrders, setMySubmittedOrders] = useState(() => createEmptySubmittedOrders());
    const [submitModalPeriod, setSubmitModalPeriod] = useState('');
    const [orderHistoryModalPeriod, setOrderHistoryModalPeriod] = useState('');
    const [cancelingItemKey, setCancelingItemKey] = useState('');

    const selectedDateLabel = useMemo(() => formatPanelDateLabel(selectedDate), [selectedDate]);
    const amDeadline = useMemo(() => getDeadlineInfo('am', nowParts, selectedDate), [nowParts, selectedDate]);
    const pmDeadline = useMemo(() => getDeadlineInfo('pm', nowParts, selectedDate), [nowParts, selectedDate]);

    useEffect(() => {
        const timer = setInterval(() => setNowTick(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);

    const loadCalendarEvents = useCallback(async () => {
        if (!user?.id) return;
        try {
            const { data, error } = await supabase
                .from('side_dish_requests')
                .select('request_date, period')
                .eq('user_id', user.id);

            if (error) {
                console.warn('Error loading side dish calendar events:', error);
                setCalendarEvents([]);
                return;
            }

            const nextEvents = (data || [])
                .filter((row) => row.request_date && row.period)
                .map((row) => ({
                    date: row.request_date,
                    type: 'special',
                    reason: row.period === 'am' ? '오전' : '오후'
                }));
            setCalendarEvents(nextEvents);
        } catch (error) {
            console.warn('Error loading side dish calendar events:', error);
            setCalendarEvents([]);
        }
    }, [user?.id]);

    const fetchFactoryTotals = useCallback(async () => {
        if (!selectedDate) return;
        try {
            const { data: totalsData, error: totalsError } = await supabase
                .rpc('get_side_dish_factory_totals', { target_request_date: selectedDate });

            if (totalsError) {
                // If DB function is not yet deployed, keep staff/admin visibility via direct fallback query.
                if (!PRIVILEGED_ROLES.has(user?.role)) {
                    console.warn('Error loading factory side dish totals via RPC:', totalsError);
                    setFactoryTotals({ am: 0, pm: 0 });
                    return;
                }

                const { data: fallbackRows, error: fallbackError } = await supabase
                    .from('side_dish_requests')
                    .select('period, total_amount, items')
                    .eq('request_date', selectedDate)
                    .eq('payment_completed', true);

                if (fallbackError) {
                    console.warn('Error loading factory side dish totals fallback:', fallbackError);
                    setFactoryTotals({ am: 0, pm: 0 });
                    return;
                }

                setFactoryTotals(summarizeFactoryTotals(fallbackRows));
                return;
            }

            setFactoryTotals(summarizeFactoryTotals(totalsData));
        } catch (error) {
            console.warn('Error loading factory side dish totals:', error);
            setFactoryTotals({ am: 0, pm: 0 });
        }
    }, [selectedDate, user?.role]);

    const loadSelectedDateRequests = useCallback(async () => {
        if (!user?.id || !selectedDate) return;

        setLoading(true);
        try {
            const myRequestsResult = await supabase
                .from('side_dish_requests')
                .select('period, items, total_amount, payment_completed, submitted_at')
                .eq('user_id', user.id)
                .eq('request_date', selectedDate);

            if (myRequestsResult.error) throw myRequestsResult.error;

            const nextAm = createEmptyRequestState();
            const nextPm = createEmptyRequestState();
            const nextSubmittedOrders = createEmptySubmittedOrders();

            (myRequestsResult.data || []).forEach((row) => {
                const normalizedItems = Array.isArray(row.items)
                    ? row.items
                        .map((item) => ({
                            name: String(item?.name || '').trim(),
                            amount: parseAmount(item?.amount)
                        }))
                        .filter((item) => item.name && item.amount > 0)
                    : [];
                const rowTotalAmount = parseAmount(row.total_amount) > 0
                    ? parseAmount(row.total_amount)
                    : normalizedItems.reduce((sum, item) => sum + item.amount, 0);
                const normalizedPeriod = row.period === 'pm' ? 'pm' : 'am';

                nextSubmittedOrders[normalizedPeriod] = {
                    items: normalizedItems,
                    totalAmount: rowTotalAmount,
                    submittedAt: row.submitted_at || null,
                    paymentCompleted: Boolean(row.payment_completed)
                };
            });

            setAmRequest(nextAm);
            setPmRequest(nextPm);
            setMySubmittedOrders(nextSubmittedOrders);
            await fetchFactoryTotals();
            await loadCalendarEvents();
        } catch (error) {
            console.error('Error loading side dish requests:', error);
        } finally {
            setLoading(false);
        }
    }, [fetchFactoryTotals, loadCalendarEvents, selectedDate, user?.id]);

    useEffect(() => {
        loadSelectedDateRequests();
    }, [loadSelectedDateRequests]);

    useEffect(() => {
        if (!selectedDate) return undefined;
        const timer = setInterval(() => {
            fetchFactoryTotals();
        }, 30000);
        return () => clearInterval(timer);
    }, [fetchFactoryTotals, selectedDate]);

    const setPeriodState = (period, updater) => {
        if (period === 'am') {
            setAmRequest((prev) => updater(prev));
        } else {
            setPmRequest((prev) => updater(prev));
        }
    };

    const addItem = (period, isClosed) => {
        if (isClosed) return;

        setPeriodState(period, (prev) => ({
            ...prev,
            items: [
                ...prev.items,
                { id: `${period}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: '', amount: '', isEditing: true }
            ]
        }));
    };

    const updateItemField = (period, id, field, value) => {
        setPeriodState(period, (prev) => ({
            ...prev,
            items: prev.items.map((item) => item.id === id ? { ...item, [field]: value } : item)
        }));
    };

    const completeItem = (period, id) => {
        const target = period === 'am' ? amRequest : pmRequest;
        const item = target.items.find((x) => x.id === id);
        if (!item) return;

        const name = String(item.name || '').trim();
        const amount = parseAmount(item.amount);

        if (!name) {
            alert('반찬명을 입력해주세요.');
            return;
        }
        if (amount <= 0) {
            alert('금액을 입력해주세요.');
            return;
        }

        setPeriodState(period, (prev) => ({
            ...prev,
            items: prev.items.map((x) => x.id === id ? { ...x, name, amount: String(amount), isEditing: false } : x)
        }));
    };

    const removeItem = (period, id) => {
        setPeriodState(period, (prev) => ({
            ...prev,
            items: prev.items.filter((item) => item.id !== id)
        }));
    };

    const getTotalAmount = (requestState) => {
        return requestState.items.reduce((sum, item) => sum + parseAmount(item.amount), 0);
    };

    const getCleanItems = (requestState) => {
        return requestState.items
            .filter((item) => String(item.name || '').trim())
            .map((item) => ({
                name: String(item.name || '').trim(),
                amount: parseAmount(item.amount)
            }))
            .filter((item) => item.amount > 0);
    };

    const submitRequest = async (period) => {
        const isLunch = period === 'am';
        const deadline = isLunch ? amDeadline : pmDeadline;
        const requestState = isLunch ? amRequest : pmRequest;

        if (deadline.closed) {
            alert(deadline.closedMessage);
            return false;
        }

        if (!requestState.paymentCompleted) {
            alert('송금을 완료 후 신청해주세요');
            return false;
        }

        if (requestState.items.some((item) => item.isEditing)) {
            alert('추가한 반찬을 완료해주세요.');
            return false;
        }

        const cleanItems = getCleanItems(requestState);
        if (cleanItems.length === 0) {
            alert('주문하실 반찬을 추가 후 신청 버튼을 눌러주세요.');
            return false;
        }

        if (!user?.id) {
            alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
            return false;
        }

        setSavingPeriod(period);
        try {
            const existingItems = Array.isArray(mySubmittedOrders[period]?.items)
                ? mySubmittedOrders[period].items.map((item) => ({
                    name: String(item?.name || '').trim(),
                    amount: parseAmount(item?.amount)
                })).filter((item) => item.name && item.amount > 0)
                : [];
            const mergedItems = [...existingItems, ...cleanItems];

            const { error } = await supabase
                .from('side_dish_requests')
                .upsert({
                    user_id: user.id,
                    request_date: selectedDate,
                    period,
                    items: mergedItems,
                    total_amount: mergedItems.reduce((sum, item) => sum + item.amount, 0),
                    payment_completed: true,
                    submitted_at: new Date().toISOString()
                }, { onConflict: 'user_id,request_date,period' });

            if (error) throw error;

            alert(`${isLunch ? '점심' : '저녁'} 반찬 신청이 완료되었습니다.`);
            setPeriodState(period, () => createEmptyRequestState());
            await loadSelectedDateRequests();
            return true;
        } catch (error) {
            console.error('Error submitting side dish request:', error);
            alert('반찬 신청 저장에 실패했습니다.');
            return false;
        } finally {
            setSavingPeriod('');
        }
    };

    const openSubmitModal = (period, deadline) => {
        const requestState = period === 'am' ? amRequest : pmRequest;
        const cleanItems = getCleanItems(requestState);
        if (deadline.closed) {
            alert(deadline.closedMessage);
            return;
        }
        if (cleanItems.length === 0) {
            alert('주문하실 반찬을 추가 후 신청 버튼을 눌러주세요.');
            return;
        }
        setOrderHistoryModalPeriod('');
        setSubmitModalPeriod(period);
    };

    const closeSubmitModal = () => {
        setSubmitModalPeriod('');
    };

    const submitFromModal = async () => {
        if (!submitModalPeriod) return;
        const success = await submitRequest(submitModalPeriod);
        if (success) {
            closeSubmitModal();
        }
    };

    const openOrderHistoryModal = (period) => {
        setSubmitModalPeriod('');
        setOrderHistoryModalPeriod(period);
    };

    const closeOrderHistoryModal = () => {
        setOrderHistoryModalPeriod('');
    };

    const cancelSubmittedOrderItem = async (period, itemIndex) => {
        const deadline = period === 'am' ? amDeadline : pmDeadline;
        const submittedOrder = mySubmittedOrders[period];
        const orderItems = Array.isArray(submittedOrder?.items) ? submittedOrder.items : [];
        const targetItem = orderItems[itemIndex];

        if (deadline.closed) {
            alert('마감시간 이후에는 주문취소가 불가능합니다.');
            return false;
        }
        if (!submittedOrder || !targetItem) {
            alert('취소할 주문내역이 없습니다.');
            return false;
        }
        if (!user?.id) {
            alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
            return false;
        }
        if (!window.confirm(`${targetItem.name} 주문을 취소하시겠습니까?`)) {
            return false;
        }

        const itemKey = `${period}-${itemIndex}`;
        setCancelingItemKey(itemKey);
        try {
            const remainingItems = orderItems.filter((_, index) => index !== itemIndex);
            const totalAmount = remainingItems.reduce((sum, item) => sum + parseAmount(item.amount), 0);
            let error = null;

            if (remainingItems.length === 0) {
                const deleteResult = await supabase
                    .from('side_dish_requests')
                    .delete()
                    .eq('user_id', user.id)
                    .eq('request_date', selectedDate)
                    .eq('period', period);
                error = deleteResult.error;
            } else {
                const updateResult = await supabase
                    .from('side_dish_requests')
                    .update({
                        items: remainingItems,
                        total_amount: totalAmount,
                        payment_completed: true
                    })
                    .eq('user_id', user.id)
                    .eq('request_date', selectedDate)
                    .eq('period', period);
                error = updateResult.error;
            }

            if (error) throw error;

            alert(`${targetItem.name} 주문이 취소되었습니다.`);
            await loadSelectedDateRequests();
            return true;
        } catch (error) {
            console.error('Error cancelling side dish request:', error);
            alert('주문 취소에 실패했습니다.');
            return false;
        } finally {
            setCancelingItemKey('');
        }
    };

    const renderPeriodPanel = (period, title, deadline, requestState) => {
        const totalAmount = getTotalAmount(requestState);
        const factoryTotalAmount = factoryTotals[period] || 0;
        const isDraftLocked = deadline.closed;

        return (
            <div style={panelStyle(deadline.closed)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '800', color: '#1f2937' }}>{`${selectedDateLabel} ${title}`}</h4>
                    <span style={{ fontSize: '0.76rem', color: '#6b7280', fontWeight: '700' }}>{deadline.text}</span>
                </div>

                <div style={{ fontSize: '0.79rem', color: '#475569', fontWeight: '700', marginBottom: '8px' }}>
                    실시간 공장반찬 주문합계 금액: {formatAmount(factoryTotalAmount)}
                </div>

                {deadline.closed && (
                    <div style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: '700', marginBottom: '8px' }}>
                        {deadline.closedMessage}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {requestState.items.length === 0 && (
                        <div style={{ fontSize: '0.82rem', color: '#9ca3af' }}>추가 버튼으로 반찬을 입력해주세요.</div>
                    )}

                    {requestState.items.map((item, index) => (
                        <div key={item.id} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '7px 8px' }}>
                            {item.isEditing ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 78px 52px', gap: '6px', alignItems: 'center', width: '100%' }}>
                                    <input
                                        type="text"
                                        value={item.name}
                                        onChange={(e) => updateItemField(period, item.id, 'name', e.target.value)}
                                        placeholder="반찬명"
                                        disabled={isDraftLocked}
                                        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '7px 8px', border: '1px solid #d1d5db', borderRadius: '7px', fontSize: '0.82rem', outline: 'none' }}
                                    />
                                    <input
                                        type="number"
                                        min="0"
                                        value={item.amount}
                                        onChange={(e) => updateItemField(period, item.id, 'amount', e.target.value)}
                                        placeholder="금액"
                                        disabled={isDraftLocked}
                                        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '7px 8px', border: '1px solid #d1d5db', borderRadius: '7px', fontSize: '0.82rem', outline: 'none' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => completeItem(period, item.id)}
                                        disabled={isDraftLocked}
                                        style={{
                                            width: '100%',
                                            padding: '7px 0',
                                            border: 'none',
                                            borderRadius: '7px',
                                            background: isDraftLocked ? '#d1d5db' : '#267E82',
                                            color: 'white',
                                            fontSize: '0.78rem',
                                            fontWeight: '700',
                                            whiteSpace: 'nowrap',
                                            cursor: isDraftLocked ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        완료
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                    <div style={{ fontSize: '0.82rem', color: '#374151' }}>
                                        {index + 1}. {item.name} · {formatAmount(parseAmount(item.amount))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeItem(period, item.id)}
                                        disabled={isDraftLocked}
                                        style={{
                                            border: 'none',
                                            background: 'none',
                                            color: isDraftLocked ? '#d1d5db' : '#ef4444',
                                            fontSize: '0.74rem',
                                            fontWeight: '700',
                                            cursor: isDraftLocked ? 'not-allowed' : 'pointer',
                                            padding: 0
                                        }}
                                    >
                                        삭제
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => addItem(period, isDraftLocked)}
                    disabled={isDraftLocked}
                    style={{
                        marginTop: '8px',
                        width: '100%',
                        padding: '8px 0',
                        borderRadius: '8px',
                        border: `1px dashed ${isDraftLocked ? '#d1d5db' : '#94a3b8'}`,
                        background: 'white',
                        color: isDraftLocked ? '#9ca3af' : '#475569',
                        fontSize: '0.82rem',
                        fontWeight: '700',
                        cursor: isDraftLocked ? 'not-allowed' : 'pointer'
                    }}
                >
                    + 추가
                </button>

                <div style={{ marginTop: '8px', fontSize: '0.86rem', fontWeight: '800', color: '#334155' }}>
                    합계: {formatAmount(totalAmount)}
                </div>

                <button
                    type="button"
                    onClick={() => openSubmitModal(period, deadline)}
                    disabled={deadline.closed}
                    style={{
                        marginTop: '8px',
                        width: '100%',
                        padding: '10px 0',
                        borderRadius: '9px',
                        border: 'none',
                        background: deadline.closed ? '#d1d5db' : '#267E82',
                        color: 'white',
                        fontSize: '0.84rem',
                        fontWeight: '800',
                        cursor: deadline.closed ? 'not-allowed' : 'pointer'
                    }}
                >
                    반찬신청
                </button>

                <button
                    type="button"
                    onClick={() => openOrderHistoryModal(period)}
                    style={{
                        marginTop: '6px',
                        width: '100%',
                        padding: '9px 0',
                        borderRadius: '9px',
                        border: '1px solid #cbd5e1',
                        background: 'white',
                        color: '#334155',
                        fontSize: '0.82rem',
                        fontWeight: '800',
                        cursor: 'pointer'
                    }}
                >
                    {period === 'am' ? '점심반찬 주문내역' : '저녁반찬 주문내역'}
                </button>
            </div>
        );
    };

    const modalRequestState = submitModalPeriod === 'am'
        ? amRequest
        : (submitModalPeriod === 'pm' ? pmRequest : null);
    const modalDeadline = submitModalPeriod === 'am'
        ? amDeadline
        : (submitModalPeriod === 'pm' ? pmDeadline : null);
    const modalCleanItems = modalRequestState ? getCleanItems(modalRequestState) : [];
    const modalTotalAmount = modalCleanItems.reduce((sum, item) => sum + item.amount, 0);
    const modalTitle = submitModalPeriod === 'am' ? '점심 반찬 신청' : '저녁 반찬 신청';
    const historyOrder = orderHistoryModalPeriod ? mySubmittedOrders[orderHistoryModalPeriod] : null;
    const historyDeadline = orderHistoryModalPeriod === 'am'
        ? amDeadline
        : (orderHistoryModalPeriod === 'pm' ? pmDeadline : null);
    const historyTitle = orderHistoryModalPeriod === 'am' ? '점심반찬 주문내역' : '저녁반찬 주문내역';
    const historyItems = Array.isArray(historyOrder?.items) ? historyOrder.items : [];
    const hasHistoryOrder = historyItems.length > 0;

    const submitModalNode = submitModalPeriod && modalRequestState ? (
        <div
            role="dialog"
            aria-modal="true"
            style={modalOverlayStyle}
            onClick={closeSubmitModal}
        >
            <div
                style={modalCardStyle}
                onClick={(event) => event.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#0f172a', fontWeight: '900' }}>
                        {`${selectedDateLabel} ${modalTitle}`}
                    </h4>
                    <button
                        type="button"
                        onClick={closeSubmitModal}
                        style={{
                            border: 'none',
                            background: 'none',
                            color: '#64748b',
                            fontSize: '0.82rem',
                            fontWeight: '800',
                            cursor: 'pointer'
                        }}
                    >
                        닫기
                    </button>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', background: '#f8fafc' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: '900', color: '#0f172a', marginBottom: '8px' }}>
                        1. 주문내용 확인
                    </div>
                    {modalCleanItems.length === 0 ? (
                        <div style={{ fontSize: '0.81rem', color: '#94a3b8', marginBottom: '6px' }}>
                            반찬을 한 개 이상 추가해주세요.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                            {modalCleanItems.map((item, index) => (
                                <div key={`${item.name}-${index}`} style={{ fontSize: '0.82rem', color: '#334155', fontWeight: '700' }}>
                                    {`${index + 1}. ${item.name} ${formatAmount(item.amount)}`}
                                </div>
                            ))}
                        </div>
                    )}
                    <div style={{ fontSize: '0.87rem', color: '#0f172a', fontWeight: '900' }}>
                        총 {formatAmount(modalTotalAmount)}
                    </div>
                </div>

                <div style={{ marginTop: '10px', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', background: '#f8fafc' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: '900', color: '#0f172a', marginBottom: '8px' }}>
                        2. 계좌이체
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#475569', fontWeight: '700', lineHeight: 1.5 }}>
                        사장님 카카오페이 또는 신한은행 계좌로 송금해주세요
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#0f172a', fontWeight: '800', marginTop: '5px' }}>
                        카카오페이: 사장님 카카오페이
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#0f172a', fontWeight: '800', marginTop: '2px' }}>
                        계좌정보: {ACCOUNT_TRANSFER_INFO}
                    </div>
                    <label style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#334155', fontWeight: '800' }}>
                        <input
                            type="checkbox"
                            checked={modalRequestState.paymentCompleted}
                            onChange={(event) => {
                                const checked = event.target.checked;
                                setPeriodState(submitModalPeriod, (prev) => ({ ...prev, paymentCompleted: checked }));
                            }}
                            style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                        />
                        송금완료
                    </label>
                </div>

                <div style={{ marginTop: '10px', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', background: '#f8fafc' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: '900', color: '#0f172a', marginBottom: '8px' }}>
                        3. 신청하기
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#475569', fontWeight: '700', lineHeight: 1.5 }}>
                        주문내용 확인 및 송금을 완료하셨으면 아래 신청 버튼을 눌러서 신청을 완료해주세요
                    </div>
                    <button
                        type="button"
                        onClick={submitFromModal}
                        disabled={savingPeriod === submitModalPeriod || modalDeadline?.closed}
                        style={{
                            marginTop: '10px',
                            width: '100%',
                            padding: '10px 0',
                            borderRadius: '9px',
                            border: 'none',
                            background: modalDeadline?.closed ? '#d1d5db' : '#267E82',
                            color: 'white',
                            fontSize: '0.84rem',
                            fontWeight: '800',
                            cursor: modalDeadline?.closed ? 'not-allowed' : (savingPeriod === submitModalPeriod ? 'wait' : 'pointer')
                        }}
                    >
                        {savingPeriod === submitModalPeriod ? '신청 중...' : '신청하기'}
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    const orderHistoryModalNode = orderHistoryModalPeriod ? (
        <div
            role="dialog"
            aria-modal="true"
            style={modalOverlayStyle}
            onClick={closeOrderHistoryModal}
        >
            <div
                style={modalCardStyle}
                onClick={(event) => event.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', color: '#0f172a', fontWeight: '900' }}>
                        {`${selectedDateLabel} ${historyTitle}`}
                    </h4>
                    <button
                        type="button"
                        onClick={closeOrderHistoryModal}
                        style={{
                            border: 'none',
                            background: 'none',
                            color: '#64748b',
                            fontSize: '0.82rem',
                            fontWeight: '800',
                            cursor: 'pointer'
                        }}
                    >
                        닫기
                    </button>
                </div>

                {!hasHistoryOrder ? (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#f8fafc', fontSize: '0.82rem', color: '#64748b', fontWeight: '700' }}>
                        주문내역이 없습니다.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', background: '#f8fafc' }}>
                            <div style={{ fontSize: '0.88rem', fontWeight: '900', color: '#0f172a', marginBottom: '8px' }}>
                                주문내용
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                                {historyItems.map((item, index) => {
                                    const itemCancelKey = `${orderHistoryModalPeriod}-${index}`;
                                    return (
                                        <div key={`${item.name}-${index}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                            <div style={{ flex: 1, fontSize: '0.82rem', color: '#334155', fontWeight: '700' }}>
                                                {`${index + 1}. ${item.name} ${formatAmount(item.amount)}`}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => cancelSubmittedOrderItem(orderHistoryModalPeriod, index)}
                                                disabled={historyDeadline?.closed || cancelingItemKey === itemCancelKey}
                                                style={{
                                                    border: 'none',
                                                    borderRadius: '7px',
                                                    background: historyDeadline?.closed ? '#d1d5db' : '#ef4444',
                                                    color: 'white',
                                                    fontSize: '0.74rem',
                                                    fontWeight: '800',
                                                    padding: '5px 8px',
                                                    cursor: historyDeadline?.closed ? 'not-allowed' : (cancelingItemKey === itemCancelKey ? 'wait' : 'pointer'),
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {cancelingItemKey === itemCancelKey ? '취소 중...' : '취소'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ fontSize: '0.87rem', color: '#0f172a', fontWeight: '900' }}>
                                총 {formatAmount(historyOrder.totalAmount)}
                            </div>
                            {historyOrder.submittedAt && (
                                <div style={{ marginTop: '6px', fontSize: '0.74rem', color: '#64748b', fontWeight: '700' }}>
                                    신청시간: {formatSubmittedAt(historyOrder.submittedAt)}
                                </div>
                            )}
                        </div>

                        {historyDeadline?.closed && (
                            <div style={{ fontSize: '0.78rem', color: '#dc2626', fontWeight: '700' }}>
                                마감시간 이후에는 주문취소가 불가능합니다.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    ) : null;

    const portalNode = typeof document !== 'undefined'
        ? createPortal(
            <>
                {submitModalNode}
                {orderHistoryModalNode}
            </>,
            document.body
        )
        : null;

    return (
        <>
            <div style={cardStyle}>
                <style>{'div::-webkit-scrollbar { display: none; }'}</style>

                <div style={{
                    border: '1px solid #d1fae5',
                    background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 100%)',
                    borderRadius: '12px',
                    padding: '12px',
                    marginBottom: '12px'
                }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: '800', color: '#0f766e', marginBottom: '8px', textAlign: 'center' }}>
                        현재 주문중인 반찬집 : 손찬반찬백화점 센텀점
                    </div>
                    <a
                        href={COUPANG_EATS_LINK}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: 'block',
                            width: 'calc(100% - 8px)',
                            margin: '0 auto',
                            boxSizing: 'border-box',
                            textAlign: 'center',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            background: '#267E82',
                            color: 'white',
                            fontSize: '0.82rem',
                            fontWeight: '800'
                        }}
                    >
                        쿠팡이츠 바로가기
                    </a>
                    <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#475569', fontWeight: '600' }}>
                        마감시간까지 최소주문금액 15,000원 미달시, 주문취소됩니다. 개별연락 드릴게요.
                    </div>
                </div>

                <div style={{ marginBottom: '14px', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '8px' }}>
                    <EmbeddedCalendar
                        selectedDate={selectedDate}
                        onSelectDate={(dateStr) => {
                            if (dateStr < todayKst) {
                                alert('지난 날짜는 신청할 수 없습니다.');
                                return;
                            }
                            setSelectedDate(dateStr);
                        }}
                        minDate={todayKst}
                        compact={true}
                        events={calendarEvents}
                        showEvents={true}
                        topAlignedDays={true}
                    />
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '16px' }}>불러오는 중...</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {renderPeriodPanel('am', '점심 반찬 신청', amDeadline, amRequest)}
                        {renderPeriodPanel('pm', '저녁 반찬 신청', pmDeadline, pmRequest)}
                    </div>
                )}
            </div>
            {portalNode}
        </>
    );
};

export default InlineSideDishRequest;
