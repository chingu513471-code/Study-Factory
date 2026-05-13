import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getTodayString } from '../utils/dateUtils';
import { parseBeverageRequestDrinks } from '../utils/beverageRequests';

const ROOM_1_LAYOUT = [
    [54, null, null, null, null, null, null],
    [53, 52, 51, 50, 49, 48, null],
    [null, null, null, null, null, null, null],
    [47, 46, 45, 44, 43, null, 7],
    [42, 41, 40, 39, 38, null, 6],
    [null, null, null, null, null, null, 5],
    [37, 36, 35, 34, 33, null, 4],
    [32, 31, 30, 29, 28, null, 3],
    [null, null, null, null, null, null, 2],
    [27, 26, 25, 24, 23, null, 1],
    [22, 21, 20, 19, 18, null, null],
    [null, null, null, null, null, null, null],
    [16, 14, 12, 10, 8, '문', null],
    [17, 15, 13, 11, 9, null, null]
];

const ROOM_2_LAYOUT = [
    [83, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [82, 81, 80, 79, 84, 85, 86, 87],
    [78, 77, 76, 75, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [74, 73, 72, 71, null, 88, 89, 90],
    [70, 69, 68, 67, null, 91, 92, 93],
    [null, null, null, null, null, null, null, null],
    [66, 65, 64, 63, null, 94, 95, 96],
    [62, 61, 60, 59, null, 97, 98, 99],
    [null, null, null, null, null, null, null, null],
    [58, 57, 56, 55, '문', 100, 101, 102]
];

const rooms = [
    { id: 'room-1', title: '1작업실', layout: ROOM_1_LAYOUT },
    { id: 'room-2', title: '2작업실', layout: ROOM_2_LAYOUT }
];

const getVacationAwayReason = (request) => {
    if (!request) return '';
    if (request.type === 'full') return '월차';

    const periods = Array.isArray(request.periods) ? request.periods : [];
    if (request.type === 'half' && periods.includes(1)) return '오전반차';
    if (request.type !== 'half' && request.type !== 'full' && periods.includes(1)) return request.reason || '기타휴무';

    return '';
};

const toKoreanTime = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};

const toKstDateString = (value) => {
    if (!value) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date(value));

    const partMap = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') partMap[part.type] = part.value;
    });

    return `${partMap.year}-${partMap.month}-${partMap.day}`;
};

const shiftDateString = (dateString, days) => {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day + days);
    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
    const nextDay = String(date.getDate()).padStart(2, '0');
    return `${nextYear}-${nextMonth}-${nextDay}`;
};

const getBeverageDisplayDate = (value) => shiftDateString(toKstDateString(value), 1);

const StaffBeverageServingSheet = ({ onBack }) => {
    const [activeRoomIndex, setActiveRoomIndex] = useState(0);
    const [seatInfoByNumber, setSeatInfoByNumber] = useState({});
    const [beverageEvents, setBeverageEvents] = useState([]);
    const [leaveEvents, setLeaveEvents] = useState([]);
    const [drinkSummary, setDrinkSummary] = useState([]);
    const dragStartXRef = useRef(null);

    const roomTransform = useMemo(() => ({
        transform: `translateX(-${activeRoomIndex * 100}%)`
    }), [activeRoomIndex]);

    const handleDragStart = (clientX) => {
        dragStartXRef.current = clientX;
    };

    const handleDragEnd = (clientX) => {
        if (dragStartXRef.current === null) return;

        const diff = clientX - dragStartXRef.current;
        dragStartXRef.current = null;

        if (Math.abs(diff) < 60) return;
        if (diff < 0) {
            setActiveRoomIndex((index) => Math.min(index + 1, rooms.length - 1));
        } else {
            setActiveRoomIndex((index) => Math.max(index - 1, 0));
        }
    };

    const fetchSeatInfo = async () => {
        try {
            const today = getTodayString();
            const { data: users, error: userError } = await supabase
                .from('authorized_users')
                .select('id, name, seat_number')
                .not('seat_number', 'is', null);

            if (userError) throw userError;

            const userIds = (users || []).map((user) => user.id);
            let requestMap = {};
            const awayMap = {};
            let vacationRows = [];
            let attendanceRows = [];

            if (userIds.length > 0) {
                const [beverageRes, vacationRes, attendanceRes, eventRes] = await Promise.all([
                    supabase
                        .from('new_beverage_requests')
                        .select('user_id, beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler, created_at, updated_at, request_note')
                        .in('user_id', userIds),
                    supabase
                        .from('vacation_requests')
                        .select('id, user_id, type, periods, reason, created_at')
                        .eq('date', today)
                        .in('user_id', userIds),
                    supabase
                        .from('attendance_logs')
                        .select('user_id, period, status')
                        .eq('date', today)
                        .eq('period', 1)
                        .in('user_id', userIds)
                        .not('status', 'is', null),
                    supabase
                        .from('new_beverage_requests')
                        .select(`
                            user_id,
                            beverage_1_choice,
                            beverage_2_choice,
                            beverage_2_custom,
                            use_personal_tumbler,
                            request_note,
                            created_at,
                            updated_at,
                            requester:user_id ( name, seat_number )
                        `)
                        .in('user_id', userIds)
                        .order('updated_at', { ascending: false })
                        .limit(30)
                ]);

                if (beverageRes.error) throw beverageRes.error;
                if (vacationRes.error) throw vacationRes.error;
                if (attendanceRes.error) throw attendanceRes.error;
                if (eventRes.error) throw eventRes.error;

                requestMap = Object.fromEntries((beverageRes.data || []).map((request) => [request.user_id, request]));
                vacationRows = vacationRes.data || [];
                attendanceRows = attendanceRes.data || [];

                vacationRows.forEach((request) => {
                    const reason = getVacationAwayReason(request);
                    if (reason) awayMap[request.user_id] = reason;
                });

                attendanceRows.forEach((log) => {
                    if (log.status) awayMap[log.user_id] = log.status;
                });

                setBeverageEvents((eventRes.data || [])
                    .map((row) => {
                        const drinks = parseBeverageRequestDrinks(row);
                        const createdDisplayDate = getBeverageDisplayDate(row.created_at);
                        const updatedDisplayDate = getBeverageDisplayDate(row.updated_at);
                        const createdAtMs = row.created_at ? new Date(row.created_at).getTime() : 0;
                        const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                        const isChangedToday = updatedDisplayDate === today && (createdDisplayDate !== today || Math.abs(updatedAtMs - createdAtMs) > 1000);
                        const eventTime = isChangedToday ? row.updated_at : row.created_at;

                        return {
                            id: `${row.user_id}_${eventTime || updatedAtMs || createdAtMs}`,
                            createdAt: eventTime || '',
                            displayDate: isChangedToday ? updatedDisplayDate : createdDisplayDate,
                            time: toKoreanTime(eventTime),
                            name: row.requester?.name || '회원',
                            seatNumber: row.requester?.seat_number,
                            action: isChangedToday ? '변경' : '신청',
                            text: drinks.length > 0 ? drinks.join(', ') : '안먹음',
                            note: row.request_note || ''
                        };
                    })
                    .filter((row) => row.displayDate === today)
                    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
            }

            const nextSeatInfo = {};
            (users || []).forEach((user) => {
                nextSeatInfo[Number(user.seat_number)] = {
                    name: user.name,
                    drinks: parseBeverageRequestDrinks(requestMap[user.id]),
                    awayReason: awayMap[user.id] || ''
                };
            });
            setSeatInfoByNumber(nextSeatInfo);

            const userById = Object.fromEntries((users || []).map((user) => [user.id, user]));
            const nextLeaveEvents = vacationRows
                .map((row) => {
                    const user = userById[row.user_id] || {};
                    return {
                        id: row.id,
                        createdAt: row.created_at || '',
                        time: toKoreanTime(row.created_at),
                        name: user.name || '회원',
                        seatNumber: user.seat_number,
                        text: formatLeaveText(row)
                    };
                })
                .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            setLeaveEvents(nextLeaveEvents);

            const summaryMap = {};
            (users || []).forEach((user) => {
                if (awayMap[user.id]) return;
                parseBeverageRequestDrinks(requestMap[user.id]).forEach((drink) => {
                    summaryMap[drink] = (summaryMap[drink] || 0) + 1;
                });
            });
            setDrinkSummary(sortDrinkSummary(summaryMap));
        } catch (error) {
            console.error('Error fetching serving seat info:', error);
        }
    };

    useEffect(() => {
        fetchSeatInfo();

        const requestChannel = supabase
            .channel('serving_sheet_beverage_requests')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'new_beverage_requests' }, fetchSeatInfo)
            .subscribe();

        const vacationChannel = supabase
            .channel('serving_sheet_vacations')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vacation_requests' }, fetchSeatInfo)
            .subscribe();

        const attendanceChannel = supabase
            .channel('serving_sheet_attendance')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_logs' }, fetchSeatInfo)
            .subscribe();

        const userChannel = supabase
            .channel('serving_sheet_users')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'authorized_users' }, fetchSeatInfo)
            .subscribe();

        return () => {
            requestChannel.unsubscribe();
            vacationChannel.unsubscribe();
            attendanceChannel.unsubscribe();
            userChannel.unsubscribe();
        };
    }, []);

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'transparent', color: '#1f2937', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, minHeight: '46px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '0 4px 10px 0', background: 'transparent', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <button onClick={onBack} style={{ width: '34px', height: '34px', border: 'none', borderRadius: '9px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <ChevronLeft size={21} color="#334155" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: '800', whiteSpace: 'nowrap' }}>음료 서빙표</h3>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {rooms.map((room, index) => (
                        <button
                            key={room.id}
                            onClick={() => setActiveRoomIndex(index)}
                            style={{
                                padding: '8px 14px',
                                minHeight: '34px',
                                borderRadius: '999px',
                                border: activeRoomIndex === index ? 'none' : '1px solid #cbd5e1',
                                background: activeRoomIndex === index ? '#267E82' : 'white',
                                color: activeRoomIndex === index ? 'white' : '#64748b',
                                fontWeight: '800',
                                fontSize: '0.86rem',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {room.title}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            <div
                onTouchStart={(event) => handleDragStart(event.touches[0].clientX)}
                onTouchEnd={(event) => handleDragEnd(event.changedTouches[0].clientX)}
                onMouseDown={(event) => handleDragStart(event.clientX)}
                onMouseUp={(event) => handleDragEnd(event.clientX)}
                style={{ height: '500px', minHeight: '500px', position: 'relative', overflow: 'hidden', touchAction: 'pan-y', cursor: 'grab' }}
            >
                <div style={{ height: '100%', display: 'flex', transition: 'transform 260ms ease', ...roomTransform }}>
                    {rooms.map((room) => (
                        <section key={room.id} style={{ width: '100%', flex: '0 0 100%', height: '100%', padding: '10px 0 0 0', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                                <div style={{ fontSize: '1.06rem', fontWeight: '900', color: '#0f172a' }}>{room.title}</div>
                                <div style={{ color: '#64748b', fontWeight: '700', fontSize: '0.76rem', paddingRight: '4px' }}>
                                    {room.layout.length > 0 ? `${room.layout.length} x ${room.layout[0]?.length || 0}` : '준비 중'}
                                </div>
                            </div>

                            {room.layout.length > 0 ? (
                                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingBottom: '8px' }}>
                                    <SeatGrid layout={room.layout} seatInfoByNumber={seatInfoByNumber} />
                                </div>
                            ) : (
                                <div style={{ flex: 1, border: '1px dashed #cbd5e1', borderRadius: '16px', background: 'rgba(255,255,255,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontWeight: '800' }}>
                                    2작업실 배치표 준비 중
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            </div>

            <InfoPanels beverageEvents={beverageEvents} leaveEvents={leaveEvents} drinkSummary={drinkSummary} />
            </div>

            <div style={{ flexShrink: 0, height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', background: 'transparent' }}>
                {rooms.map((room, index) => (
                    <span
                        key={room.id}
                        style={{
                            width: activeRoomIndex === index ? '22px' : '7px',
                            height: '7px',
                            borderRadius: '999px',
                            background: activeRoomIndex === index ? '#267E82' : '#cbd5e1',
                            transition: 'all 180ms ease'
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

const formatLeaveText = (row) => {
    if (row.type === 'full') return '월차';
    const periods = Array.isArray(row.periods) ? row.periods : [];
    if (row.type === 'half') {
        return periods.includes(1) ? `오전반차 ${periods.join(',')}교시` : `오후반차 ${periods.join(',')}교시`;
    }
    return `${row.reason || '기타휴무'} ${periods.length > 0 ? `${periods.join(',')}교시` : ''}`.trim();
};

const sortDrinkSummary = (summaryMap) => {
    const priority = ['아아', '선식', '해독주스'];
    return Object.entries(summaryMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
            const aIdx = priority.indexOf(a.name);
            const bIdx = priority.indexOf(b.name);
            if (aIdx !== -1 || bIdx !== -1) {
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
            }
            return a.name.localeCompare(b.name, 'ko');
        });
};

const InfoPanels = ({ beverageEvents, leaveEvents, drinkSummary }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr 0.85fr', gap: '8px', marginTop: '8px', paddingBottom: '8px' }}>
        <InfoPanel title="음료 참고">
            {beverageEvents.length === 0 ? (
                <EmptyText text="음료 변경 내역 없음" />
            ) : beverageEvents.slice(0, 8).map((item) => (
                <CompactLine key={item.id} left={`${item.time} ${item.seatNumber ? `${item.seatNumber}번 ` : ''}${item.name}`} right={`${item.action} · ${item.text}`} sub={item.note} />
            ))}
        </InfoPanel>

        <InfoPanel title="오늘 휴무">
            {leaveEvents.length === 0 ? (
                <EmptyText text="휴무 신청 없음" />
            ) : leaveEvents.slice(0, 8).map((item) => (
                <CompactLine key={item.id} left={`${item.time} ${item.seatNumber ? `${item.seatNumber}번 ` : ''}${item.name}`} right={item.text} />
            ))}
        </InfoPanel>

        <InfoPanel title="제조 수량">
            {drinkSummary.length === 0 ? (
                <EmptyText text="제조할 음료 없음" />
            ) : drinkSummary.map((item) => (
                <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.72rem', fontWeight: '800', color: '#155e63', lineHeight: 1.35 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    <span>{item.count}</span>
                </div>
            ))}
        </InfoPanel>
    </div>
);

const InfoPanel = ({ title, children }) => (
    <div style={{ minHeight: '98px', maxHeight: '128px', overflow: 'auto', background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)' }}>
        <div style={{ fontSize: '0.76rem', fontWeight: '900', color: '#0f172a', marginBottom: '5px' }}>{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>{children}</div>
    </div>
);

const CompactLine = ({ left, right, sub }) => (
    <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '2px' }}>
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', fontSize: '0.66rem', lineHeight: 1.25 }}>
            <span style={{ color: '#64748b', fontWeight: '800', whiteSpace: 'nowrap' }}>{left}</span>
            <span style={{ color: '#155e63', fontWeight: '800', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{right}</span>
        </div>
        {sub && <div style={{ color: '#94a3b8', fontSize: '0.6rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
);

const EmptyText = ({ text }) => (
    <div style={{ color: '#94a3b8', fontSize: '0.7rem', fontWeight: '700' }}>{text}</div>
);

const SeatGrid = ({ layout, seatInfoByNumber }) => {
    const columnCount = Math.max(...layout.map((row) => row.length));
    const rowCount = layout.length;

    return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rowCount}, 31px)`, gap: '3px', padding: '6px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 3px 10px rgba(15, 23, 42, 0.04)', width: '100%', boxSizing: 'border-box' }}>
        {layout.flatMap((row, rowIndex) => (
            row.map((cell, colIndex) => (
                <SeatCell key={`${rowIndex}-${colIndex}`} value={cell} info={seatInfoByNumber[cell]} />
            ))
        ))}
        </div>
    );
};

const SeatCell = ({ value, info }) => {
    const isDoor = value === '문';
    const isEmpty = value === null;
    const isAway = Boolean(info?.awayReason);

    return (
        <div style={{
            minWidth: 0,
            borderRadius: '6px',
            border: isEmpty ? '1px dashed transparent' : isDoor ? '1px solid #94a3b8' : isAway ? '1px solid #cbd5e1' : '1px solid #bfd7d8',
            background: isEmpty ? 'transparent' : isDoor ? '#e2e8f0' : isAway ? '#f1f5f9' : '#f0fdfa',
            color: isDoor ? '#475569' : isAway ? '#64748b' : '#155e63',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            fontWeight: '900',
            fontSize: '0.58rem',
            boxShadow: isEmpty ? 'none' : 'inset 0 -1px 0 rgba(15,23,42,0.04)',
            userSelect: 'none',
            overflow: 'hidden',
            padding: isEmpty ? 0 : '0 3px',
            boxSizing: 'border-box',
            lineHeight: 1.06
        }}>
            {!isEmpty && !isDoor && (
                <>
                    <div style={{ width: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: '2px', minHeight: '10px', color: isAway ? '#64748b' : '#134e4a' }}>
                        <span style={{ flexShrink: 0, fontSize: '0.58rem' }}>{value}</span>
                        {info?.name && (
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.54rem' }}>
                                {info.name}
                            </span>
                        )}
                    </div>
                    <div style={{ width: '100%', marginTop: '0', color: isAway ? '#94a3b8' : '#0f766e', fontWeight: '700', fontSize: '0.48rem', lineHeight: 1.05, overflow: 'hidden', textAlign: 'center', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {isAway ? info.awayReason : info?.drinks?.join(', ')}
                    </div>
                </>
            )}
            {isDoor ? value : ''}
        </div>
    );
};

export default StaffBeverageServingSheet;
