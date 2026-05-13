import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { formatBeverageRequestText } from '../utils/beverageRequests';

const cardStyle = {
    background: 'white',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    padding: '10px 12px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
};

const StaffNewBeverageRequestList = ({ onBack }) => {
    const [loading, setLoading] = useState(true);
    const [requests, setRequests] = useState([]);
    const [sortMode, setSortMode] = useState('seat'); // seat | name

    const fetchRequests = useCallback(async () => {
        setLoading(true);

        try {
            let requestQuery = supabase
                .from('new_beverage_requests')
                .select('user_id, beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler, request_note, updated_at')
                .order('updated_at', { ascending: false });

            const { data: requestData, error: requestError } = await requestQuery;

            if (requestError) throw requestError;

            const rows = requestData || [];
            if (rows.length === 0) {
                setRequests([]);
                return;
            }

            const userIds = rows.map((row) => row.user_id);

            const { data: userData, error: userError } = await supabase
                .from('authorized_users')
                .select('id, name, seat_number, branch')
                .in('id', userIds);
            if (userError) throw userError;

            const userMap = new Map((userData || []).map((user) => [user.id, user]));

            const merged = rows
                .map((row) => {
                    const user = userMap.get(row.user_id);
                    if (!user) return null;

                    return {
                        id: row.user_id,
                        name: user.name,
                        seatNumber: user.seat_number,
                        branch: user.branch,
                        beverageText: formatBeverageRequestText(row),
                        requestNote: row.request_note || '',
                        updatedAt: row.updated_at
                    };
                })
                .filter(Boolean);

            setRequests(merged);
        } catch (error) {
            console.error('Error fetching new beverage requests:', error);
            alert('새로운 음료 신청 데이터를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRequests();
    }, [fetchRequests]);

    const sortedRequests = useMemo(() => {
        const list = [...requests];

        if (sortMode === 'name') {
            list.sort((a, b) => {
                const nameCmp = (a.name || '').localeCompare(b.name || '', 'ko');
                if (nameCmp !== 0) return nameCmp;
                if (a.seatNumber && b.seatNumber) return a.seatNumber - b.seatNumber;
                if (a.seatNumber) return -1;
                if (b.seatNumber) return 1;
                return 0;
            });
            return list;
        }

        list.sort((a, b) => {
            if (a.seatNumber && b.seatNumber) return a.seatNumber - b.seatNumber;
            if (a.seatNumber) return -1;
            if (b.seatNumber) return 1;
            return (a.name || '').localeCompare(b.name || '', 'ko');
        });
        return list;
    }, [requests, sortMode]);

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                <button
                    onClick={onBack}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '0 8px 0 0',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    <ChevronLeft size={24} color="#2d3748" />
                </button>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>새로운 음료 신청</h3>
            </div>

            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
                {[{ key: 'name', label: '이름순' }, { key: 'seat', label: '번호순' }].map((sort) => (
                    <button
                        key={sort.key}
                        onClick={() => setSortMode(sort.key)}
                        style={{
                            padding: '6px 12px',
                            borderRadius: '20px',
                            border: sortMode === sort.key ? 'none' : '1px solid #e2e8f0',
                            background: sortMode === sort.key ? 'var(--color-primary)' : 'white',
                            color: sortMode === sort.key ? 'white' : '#718096',
                            fontSize: '0.85rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                        }}
                    >
                        {sort.label}
                    </button>
                ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', marginTop: '20px', color: '#a0aec0' }}>로딩 중...</div>
                ) : requests.length === 0 ? (
                    <div style={{ textAlign: 'center', marginTop: '20px', color: '#a0aec0' }}>새로운 음료 신청 내역이 없습니다.</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {sortedRequests.map((item) => (
                            <div key={item.id} style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                                    <div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '0.95rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                        {(item.seatNumber || '-')}번 {item.name}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0 }}>
                                        <div style={{
                                            color: '#4a5568',
                                            fontSize: '0.85rem',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            textAlign: 'right'
                                        }}>
                                            {item.beverageText}
                                        </div>
                                        {item.requestNote && (
                                            <div style={{
                                                color: '#718096',
                                                fontSize: '0.76rem',
                                                marginTop: '2px',
                                                whiteSpace: 'normal',
                                                wordBreak: 'break-word',
                                                textAlign: 'right'
                                            }}>
                                                요청사항: {item.requestNote}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StaffNewBeverageRequestList;
