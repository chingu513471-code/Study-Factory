import React, { useState, useEffect } from 'react';
import { ChevronLeft, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { BRANCH_OPTIONS } from '../constants/branches';
import EmbeddedCalendar from '../components/EmbeddedCalendar';
import { formatDateWithDay, getTodayString } from '../utils/dateUtils';
import { parseBeverageRequestDrinks } from '../utils/beverageRequests';

const StaffBeverageOrderList = ({ onBack }) => {
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState([]); // [{ beverageName, count, users: [name, ...] }]
    const [absentUsers, setAbsentUsers] = useState([]); // List of names excluded
    const [selectedBranch, setSelectedBranch] = useState('망미점');
    const [date, setDate] = useState(getTodayString());
    const [showCalendar, setShowCalendar] = useState(false);

    const branches = BRANCH_OPTIONS.filter(b => b !== '전체');

    useEffect(() => {
        const updateDate = () => {
            const today = getTodayString();
            setDate(today);
        };
        window.addEventListener('focus', updateDate);
        return () => window.removeEventListener('focus', updateDate);
    }, []);

    useEffect(() => {
        fetchData();
    }, [selectedBranch, date]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const today = date;

            // 1. Fetch Users in Branch (Seated) - ID synchronized with profiles
            const { data: userData, error: userError } = await supabase
                .from('authorized_users')
                .select('id, name, seat_number')
                .eq('branch', selectedBranch)
                .not('seat_number', 'is', null) // Only seated
                .order('seat_number', { ascending: true });

            if (userError) throw userError;
            const allUsers = (userData || []).filter(u => u && u.seat_number); // Filter valid users

            // 2. Fetch unified beverage requests
            const userIds = allUsers.map(u => u.id);
            const { data: requestData, error: requestError } = await supabase
                .from('new_beverage_requests')
                .select('user_id, beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler')
                .in('user_id', userIds);

            if (requestError) throw requestError;

            const requestMap = {};
            (requestData || []).forEach(request => requestMap[request.user_id] = request);

            // 4. Fetch Today's Vacation Requests (To exclude absentees)
            // Logic: Exclude if type='full' OR (type='half' AND periods includes 1)
            const { data: vacationData, error: vacationError } = await supabase
                .from('vacation_requests')
                .select('user_id, type, periods')
                .eq('date', today)
                .in('user_id', userIds);

            if (vacationError) throw vacationError;

            // 4.5 Fetch Attendance Logs (To exclude daily absentees like Sick/Late for Period 1)
            const { data: attendanceData, error: attendanceError } = await supabase
                .from('attendance_logs')
                .select('user_id, period, status')
                .eq('date', today)
                .in('user_id', userIds)
                .not('status', 'is', null);

            if (attendanceError) throw attendanceError;

            const absentUserIdSet = new Set();

            // Allow-list for Vacation Requests
            (vacationData || []).forEach(req => {
                if (req.type === 'full') {
                    absentUserIdSet.add(req.user_id);
                } else if (req.type === 'half') {
                    // Check if period 1 is included (Morning absence)
                    if (req.periods && req.periods.includes(1)) {
                        absentUserIdSet.add(req.user_id);
                    }
                }
            });

            // Allow-list for Attendance Logs
            (attendanceData || []).forEach(log => {
                // If there is ANY log for Period 1 with status, they are absent/late for morning.
                // Assuming 'status' implies they are NOT here. (e.g., '결석', '지각', '병결'...)
                // Except if status is '출석' (which usually isn't logged unless special system, but logs usually mean exception)
                // In TodayLeaves.jsx, all logs with status are shown as "Special Log".
                // If Period 1 is logged, they are effectively "not in standard 1st period class" or "late/absent".
                // So we exclude them.
                if (log.period === 1) {
                    absentUserIdSet.add(log.user_id);
                }
            });

            // 5. Aggregate Orders
            const orderMap = {}; // beverage_name -> { count, users: [] }
            const absentList = [];

            allUsers.forEach(user => {
                if (absentUserIdSet.has(user.id)) {
                    absentList.push(`${user.name} (${user.seat_number})`);
                    return; // Skip absentee
                }

                parseBeverageRequestDrinks(requestMap[user.id]).forEach(beverageName => {
                    if (!beverageName) return;

                    if (!orderMap[beverageName]) {
                        orderMap[beverageName] = { count: 0, users: [] };
                    }

                    orderMap[beverageName].count++;
                    orderMap[beverageName].users.push(`${user.name} (${user.seat_number})`);
                });
            });

            // Convert to array and sort by count DESC
            const sortedOrders = Object.entries(orderMap)
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.count - a.count);

            setOrders(sortedOrders);
            setAbsentUsers(absentList);

        } catch (err) {
            console.error('Error fetching order list:', err);
            alert('데이터를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    };

    // Unified color for all cards (matches logout button / primary color)
    const cardColors = [
        { header: '#387679', body: '#e6fffa', text: '#234e52' }, // Teal (Primary)
    ];

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 0 20px 0' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', display: 'flex', alignItems: 'center' }}>
                        <ChevronLeft size={24} color="#2d3748" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>음료 제조표</h3>
                </div>
                {/* Date Picker Button */}
                <button
                    onClick={() => setShowCalendar(!showCalendar)}
                    style={{
                        padding: '6px 12px',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        background: 'white',
                        display: 'flex', alignItems: 'center', gap: '5px',
                        fontSize: '0.9rem', fontWeight: 'bold', color: '#2d3748',
                        cursor: 'pointer'
                    }}
                >
                    {formatDateWithDay(date)}
                    <Calendar size={16} color="#718096" />
                </button>
            </div>

            {showCalendar && (
                <div style={{ position: 'absolute', top: '60px', right: '20px', zIndex: 100, background: 'white', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0', padding: '10px' }}>
                    <EmbeddedCalendar
                        selectedDate={date}
                        onSelectDate={(val) => {
                            setDate(val);
                            setShowCalendar(false);
                        }}
                    />
                </div>
            )}

            {/* Branch Selection */}
            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px', overflowX: 'auto', paddingBottom: '5px', scrollbarWidth: 'none' }}>
                {branches.map(b => (
                    <button
                        key={b}
                        onClick={() => setSelectedBranch(b)}
                        style={{
                            padding: '6px 12px',
                            borderRadius: '20px',
                            border: selectedBranch === b ? 'none' : '1px solid #e2e8f0',
                            background: selectedBranch === b ? 'var(--color-primary)' : 'white',
                            color: selectedBranch === b ? 'white' : '#718096',
                            fontSize: '0.85rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {b}
                    </button>
                ))}
            </div>

            {/* Content Aggregation */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', marginTop: '20px', color: '#a0aec0' }}>로딩 중...</div>
                ) : (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '15px', marginBottom: '20px' }}>
                            {orders.map((order, idx) => {
                                const theme = cardColors[idx % cardColors.length];
                                // Create a unique key for state tracking if needed, or manage state locally in a sub-component
                                // Simpler approach: Create a local sub-component or use useState with an object
                                return <BeverageCard key={order.name} order={order} theme={theme} />;
                            })}
                            {orders.length === 0 && (
                                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: '#a0aec0' }}>
                                    제조할 음료가 없습니다.
                                </div>
                            )}
                        </div>

                        {/* Absentee Info (Optional debug or info) */}
                        {absentUsers.length > 0 && (
                            <div style={{ padding: '15px', background: '#f7fafc', borderRadius: '8px', border: '1px solid #edf2f7' }}>
                                <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#718096' }}>제외된 인원 (오전 부재)</h4>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.85rem', color: '#a0aec0' }}>
                                    {absentUsers.map((u, i) => <span key={i}>{u}</span>)}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

const BeverageCard = ({ order, theme }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <div
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                    background: theme.header,
                    color: 'white',
                    padding: '10px 35px 10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    position: 'relative',
                    minHeight: '40px',
                    textAlign: 'center',
                    lineHeight: '1.3',
                    wordBreak: 'keep-all'
                }}>
                <span>{order.name} <span style={{ fontSize: '0.9rem', marginLeft: '3px' }}>({order.count})</span></span>
                <div style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
                    <svg
                        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                    >
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
            </div>

            {isExpanded && (
                <div style={{
                    background: theme.body,
                    color: theme.text,
                    padding: '10px',
                    minHeight: '50px',
                    fontSize: '0.9rem',
                    lineHeight: '1.5',
                    borderTop: `1px solid ${theme.header}40`
                }}>
                    {order.users.map((u, i) => (
                        <div key={i}>{u}</div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default StaffBeverageOrderList;
