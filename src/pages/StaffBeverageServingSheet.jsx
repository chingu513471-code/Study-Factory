import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ROOM_1_LAYOUT = [
    [54, null, null, null, null, null, null],
    [53, 52, 51, 50, 49, 48, null],
    [null, null, null, null, null, null, 7],
    [47, 46, 45, 44, 43, null, 6],
    [42, 41, 40, 39, 38, null, 5],
    [null, null, null, null, null, null, 4],
    [37, 36, 35, 34, 33, null, 3],
    [32, 31, 30, 29, 28, null, 2],
    [null, null, null, null, null, null, 1],
    [27, 26, 25, 24, 23, null, null],
    [22, 21, 20, 19, 18, null, null],
    [null, null, null, null, null, null, null],
    [16, 14, 12, 10, 8, '문', null],
    [17, 15, 13, 11, 9, null, null]
];

const rooms = [
    { id: 'room-1', title: '1작업실', layout: ROOM_1_LAYOUT },
    { id: 'room-2', title: '2작업실', layout: [] }
];

const StaffBeverageServingSheet = ({ onBack }) => {
    const [activeRoomIndex, setActiveRoomIndex] = useState(0);

    const activeRoom = rooms[activeRoomIndex];

    const canGoPrev = activeRoomIndex > 0;
    const canGoNext = activeRoomIndex < rooms.length - 1;

    const roomTransform = useMemo(() => ({
        transform: `translateX(-${activeRoomIndex * 100}%)`
    }), [activeRoomIndex]);

    return (
        <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#f5f7fb',
            color: '#1f2937',
            overflow: 'hidden'
        }}>
            <div style={{
                flexShrink: 0,
                height: '58px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '0 18px',
                background: 'white',
                borderBottom: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <button
                        onClick={onBack}
                        style={{
                            width: '40px',
                            height: '40px',
                            border: 'none',
                            borderRadius: '10px',
                            background: '#f1f5f9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer'
                        }}
                    >
                        <ChevronLeft size={24} color="#334155" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', whiteSpace: 'nowrap' }}>음료 서빙표</h3>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {rooms.map((room, index) => (
                        <button
                            key={room.id}
                            onClick={() => setActiveRoomIndex(index)}
                            style={{
                                padding: '8px 14px',
                                borderRadius: '999px',
                                border: activeRoomIndex === index ? 'none' : '1px solid #cbd5e1',
                                background: activeRoomIndex === index ? '#267E82' : 'white',
                                color: activeRoomIndex === index ? 'white' : '#64748b',
                                fontWeight: '800',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {room.title}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    display: 'flex',
                    transition: 'transform 260ms ease',
                    ...roomTransform
                }}>
                    {rooms.map((room) => (
                        <section
                            key={room.id}
                            style={{
                                width: '100%',
                                flex: '0 0 100%',
                                height: '100%',
                                padding: '18px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '14px',
                                overflow: 'hidden'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                                <div>
                                    <div style={{ fontSize: '1.45rem', fontWeight: '900', color: '#0f172a' }}>{room.title}</div>
                                </div>
                                <div style={{ color: '#64748b', fontWeight: '700', fontSize: '0.92rem' }}>
                                    {room.layout.length > 0 ? '14 x 7' : '준비 중'}
                                </div>
                            </div>

                            {room.layout.length > 0 ? (
                                <SeatGrid layout={room.layout} />
                            ) : (
                                <div style={{
                                    flex: 1,
                                    border: '1px dashed #cbd5e1',
                                    borderRadius: '16px',
                                    background: 'rgba(255,255,255,0.72)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#94a3b8',
                                    fontWeight: '800'
                                }}>
                                    2작업실 배치표 준비 중
                                </div>
                            )}
                        </section>
                    ))}
                </div>

                <button
                    onClick={() => canGoPrev && setActiveRoomIndex((idx) => idx - 1)}
                    disabled={!canGoPrev}
                    style={navButtonStyle('left', !canGoPrev)}
                >
                    <ChevronLeft size={28} />
                </button>
                <button
                    onClick={() => canGoNext && setActiveRoomIndex((idx) => idx + 1)}
                    disabled={!canGoNext}
                    style={navButtonStyle('right', !canGoNext)}
                >
                    <ChevronRight size={28} />
                </button>
            </div>

            <div style={{
                flexShrink: 0,
                height: '34px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
                background: '#f5f7fb'
            }}>
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

const SeatGrid = ({ layout }) => (
    <div style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(74px, 1fr))',
        gridTemplateRows: 'repeat(14, minmax(42px, 1fr))',
        gap: '8px',
        padding: '12px',
        borderRadius: '18px',
        background: 'white',
        border: '1px solid #e2e8f0',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)'
    }}>
        {layout.flatMap((row, rowIndex) => (
            row.map((cell, colIndex) => (
                <SeatCell key={`${rowIndex}-${colIndex}`} value={cell} />
            ))
        ))}
    </div>
);

const SeatCell = ({ value }) => {
    const isDoor = value === '문';
    const isEmpty = value === null;

    return (
        <div style={{
            borderRadius: '10px',
            border: isEmpty ? '1px dashed transparent' : isDoor ? '1px solid #94a3b8' : '1px solid #bfd7d8',
            background: isEmpty ? 'transparent' : isDoor ? '#e2e8f0' : '#f0fdfa',
            color: isDoor ? '#475569' : '#155e63',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '900',
            fontSize: isDoor ? '1rem' : '1.18rem',
            boxShadow: isEmpty ? 'none' : 'inset 0 -1px 0 rgba(15,23,42,0.04)',
            userSelect: 'none'
        }}>
            {!isEmpty ? value : ''}
        </div>
    );
};

const navButtonStyle = (side, disabled) => ({
    position: 'absolute',
    top: '50%',
    [side]: '18px',
    transform: 'translateY(-50%)',
    width: '46px',
    height: '46px',
    borderRadius: '999px',
    border: '1px solid #dbe3ea',
    background: disabled ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.92)',
    color: disabled ? '#cbd5e1' : '#267E82',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : '0 8px 18px rgba(15, 23, 42, 0.12)'
});

export default StaffBeverageServingSheet;
