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

const rooms = [
    { id: 'room-1', title: '1작업실', layout: ROOM_1_LAYOUT },
    { id: 'room-2', title: '2작업실', layout: [] }
];

const getVacationAwayReason = (request) => {
    if (!request) return '';
    if (request.type === 'full') return '월차';

    const periods = Array.isArray(request.periods) ? request.periods : [];
    if (request.type === 'half' && periods.includes(1)) return '오전반차';
    if (request.type !== 'half' && request.type !== 'full' && periods.includes(1)) return request.reason || '기타휴무';

    return '';
};

const StaffBeverageServingSheet = ({ onBack }) => {
    const [activeRoomIndex, setActiveRoomIndex] = useState(0);
    const [seatInfoByNumber, setSeatInfoByNumber] = useState({});
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

            if (userIds.length > 0) {
                const [beverageRes, vacationRes, attendanceRes] = await Promise.all([
                    supabase
                        .from('new_beverage_requests')
                        .select('user_id, beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler')
                        .in('user_id', userIds),
                    supabase
                        .from('vacation_requests')
                        .select('user_id, type, periods, reason')
                        .eq('date', today)
                        .in('user_id', userIds),
                    supabase
                        .from('attendance_logs')
                        .select('user_id, period, status')
                        .eq('date', today)
                        .eq('period', 1)
                        .in('user_id', userIds)
                        .not('status', 'is', null)
                ]);

                if (beverageRes.error) throw beverageRes.error;
                if (vacationRes.error) throw vacationRes.error;
                if (attendanceRes.error) throw attendanceRes.error;

                requestMap = Object.fromEntries((beverageRes.data || []).map((request) => [request.user_id, request]));

                (vacationRes.data || []).forEach((request) => {
                    const reason = getVacationAwayReason(request);
                    if (reason) awayMap[request.user_id] = reason;
                });

                (attendanceRes.data || []).forEach((log) => {
                    if (log.status) awayMap[log.user_id] = log.status;
                });
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

            <div
                onTouchStart={(event) => handleDragStart(event.touches[0].clientX)}
                onTouchEnd={(event) => handleDragEnd(event.changedTouches[0].clientX)}
                onMouseDown={(event) => handleDragStart(event.clientX)}
                onMouseUp={(event) => handleDragEnd(event.clientX)}
                style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', touchAction: 'pan-y', cursor: 'grab' }}
            >
                <div style={{ height: '100%', display: 'flex', transition: 'transform 260ms ease', ...roomTransform }}>
                    {rooms.map((room) => (
                        <section key={room.id} style={{ width: '100%', flex: '0 0 100%', height: '100%', padding: '10px 0 0 0', display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                                <div style={{ fontSize: '1.06rem', fontWeight: '900', color: '#0f172a' }}>{room.title}</div>
                                <div style={{ color: '#64748b', fontWeight: '700', fontSize: '0.76rem', paddingRight: '4px' }}>
                                    {room.layout.length > 0 ? '14 x 7' : '준비 중'}
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

const SeatGrid = ({ layout, seatInfoByNumber }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: 'repeat(14, 31px)', gap: '3px', padding: '6px', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 3px 10px rgba(15, 23, 42, 0.04)', width: '100%', boxSizing: 'border-box' }}>
        {layout.flatMap((row, rowIndex) => (
            row.map((cell, colIndex) => (
                <SeatCell key={`${rowIndex}-${colIndex}`} value={cell} info={seatInfoByNumber[cell]} />
            ))
        ))}
    </div>
);

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
