import React, { useState, useEffect } from 'react';
import { ChevronLeft, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { BRANCH_OPTIONS } from '../constants/branches';
import EmbeddedCalendar from '../components/EmbeddedCalendar';
import { formatDateWithDay, getTodayString } from '../utils/dateUtils';
import { parseBeverageRequestDrinks } from '../utils/beverageRequests';

const StaffBeverageServingSheet = ({ onBack }) => {
    const [loading, setLoading] = useState(true);
    const [seatData, setSeatData] = useState([]); // Array of { seatNo, user: { name, ... }, status: 'present'|'absent'|'empty', details: ... }
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

            // 1. Fetch ALL Users in Branch (Seated only)
            const { data: userData, error: userError } = await supabase
                .from('authorized_users')
                .select('id, name, seat_number')
                .eq('branch', selectedBranch)
                .not('seat_number', 'is', null)
                .order('seat_number', { ascending: true });

            if (userError) throw userError;

            // 2. Fetch unified beverage requests
            const userIds = (userData || []).map(u => u.id);
            let requestMap = {};
            if (userIds.length > 0) {
                const { data: requestData } = await supabase
                    .from('new_beverage_requests')
                    .select('user_id, beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler')
                    .in('user_id', userIds);
                (requestData || []).forEach(request => requestMap[request.user_id] = request);
            }

            // 3. Check Absences (Vacation & Attendance Logs)
            let absenceMap = {}; // userId -> reason (string)

            if (userIds.length > 0) {
                // Vacation Requests
                const { data: vacData } = await supabase
                    .from('vacation_requests')
                    .select('user_id, type, periods')
                    .eq('date', today)
                    .in('user_id', userIds);

                (vacData || []).forEach(req => {
                    if (req.type === 'full') absenceMap[req.user_id] = '월차';
                    else if (req.type === 'half' && req.periods?.includes(1)) absenceMap[req.user_id] = '오전반차'; // Assuming morning absence checks period 1
                });

                // Attendance Logs (Daily Status like Late, Hospital, etc.)
                const { data: attData } = await supabase
                    .from('attendance_logs')
                    .select('user_id, status, period')
                    .eq('date', today)
                    .in('user_id', userIds)
                    .not('status', 'is', null);

                (attData || []).forEach(log => {
                    // If marked with a status for period 1, treat as absent/late for serving time
                    if (log.period === 1) {
                        // If already has a reason, append or overwrite? Overwrite is usually fine or detail it.
                        absenceMap[log.user_id] = log.status;
                    }
                });
            }

            // 4. Build Seat Grid
            // Simple approach: list all seated users + empty slots up to max seat?
            // "1번부터 좌석 쫙 놓은 다음에" -> Sequential list.
            const maxSeat = userData && userData.length > 0 ? Math.max(...userData.map(u => u.seat_number)) : 0;
            const gridLimit = Math.max(maxSeat, 20); // Show at least 20

            const finalData = [];
            const userSeatMap = {};
            (userData || []).forEach(u => userSeatMap[u.seat_number] = u);

            for (let i = 1; i <= gridLimit; i++) {
                const user = userSeatMap[i];
                if (!user) {
                    finalData.push({ seatNo: i, status: 'empty' });
                    continue;
                }

                const absenceReason = absenceMap[user.id];
                if (absenceReason) {
                    finalData.push({
                        seatNo: i,
                        status: 'absent',
                        user,
                        reason: absenceReason
                    });
                } else {
                    finalData.push({
                        seatNo: i,
                        status: 'present',
                        user,
                        beverages: parseBeverageRequestDrinks(requestMap[user.id])
                    });
                }
            }

            setSeatData(finalData);

        } catch (err) {
            console.error(err);
            alert('데이터 로딩 실패');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 0 20px 0' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', display: 'flex', alignItems: 'center' }}>
                        <ChevronLeft size={24} color="#2d3748" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>음료 서빙표</h3>
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

            {/* Grid Content: Single Column */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr', // Single column as requested
                    gap: '8px' // Reduced gap
                }}>
                    {seatData.map(item => (
                        <SeatCard key={item.seatNo} item={item} />
                    ))}
                </div>
                {seatData.length === 0 && !loading && (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#a0aec0' }}>데이터가 없습니다.</div>
                )}
            </div>
        </div>
    );
};

const SeatCard = ({ item }) => {
    // Styles based on status
    let cardStyle = {
        borderRadius: '8px',
        padding: '8px 12px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column', // Beverages below header
        justifyContent: 'center',
        minHeight: '40px',
        position: 'relative',
        border: '1px solid #e2e8f0',
        background: 'white'
    };

    // Badge Styles (Oval)
    let badgeStyle = {
        fontSize: '0.75rem',
        padding: '2px 8px',
        borderRadius: '12px',
        fontWeight: 'bold',
        display: 'inline-block',
        marginLeft: '10px' // Attached to name with small gap
    };

    // Status Colors
    if (item.status === 'present') {
        cardStyle.background = '#f0fff4';
        cardStyle.border = '1px solid #9ae6b4';
        badgeStyle.background = '#c6f6d5';
        badgeStyle.color = '#22543d';
        badgeStyle.border = '1px solid #48bb78';
    } else if (item.status === 'absent') {
        cardStyle.background = '#fff5f5';
        cardStyle.border = '1px solid #feb2b2';
        badgeStyle.background = '#fed7d7'; // Light red bg for badge
        badgeStyle.color = '#9b2c2c'; // Dark red text
        badgeStyle.border = '1px solid #f56565';
    } else {
        cardStyle.background = '#f7fafc';
        cardStyle.border = '1px solid #edf2f7';
        badgeStyle.background = '#edf2f7';
        badgeStyle.color = '#a0aec0';
        badgeStyle.border = '1px solid #cbd5e0';
    }

    return (
        <div style={cardStyle}>
            {/* Header Row: Seat | Name | Badge */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    color: item.status === 'empty' ? '#a0aec0' : (item.status === 'present' ? '#2f855a' : '#c53030'),
                    width: '30px',
                    textAlign: 'center',
                    marginRight: '6px'
                }}>
                    {item.seatNo}
                </span>

                {item.status !== 'empty' && (
                    <>
                        <span style={{
                            fontSize: '1rem',
                            fontWeight: 'bold',
                            color: '#2d3748'
                        }}>
                            {item.user.name}
                        </span>

                        {/* Status Badge */}
                        {item.status === 'present' ? (
                            <span style={{ ...badgeStyle, marginLeft: 'auto' }}>정상출근</span>
                        ) : (
                            <span style={{ ...badgeStyle, marginLeft: 'auto' }}>{item.reason}</span>
                        )}
                    </>
                )}

                {item.status === 'empty' && (
                    <span style={{ fontSize: '0.9rem', color: '#cbd5e0', marginLeft: '10px' }}>미배정</span>
                )}
            </div>

            {/* Content: Beverages (Below the header) */}
            {item.status === 'present' && item.beverages && item.beverages.length > 0 && (
                <div style={{ marginTop: '4px', paddingLeft: '45px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {item.beverages.map((bev, idx) => (
                        <span key={idx} style={{ fontSize: '0.85rem', color: '#276749', fontWeight: '500' }}>
                            - {bev}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

export default StaffBeverageServingSheet;
