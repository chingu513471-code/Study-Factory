import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronDown, ChevronUp, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { BRANCH_OPTIONS } from '../constants/branches';
import { buildBeverageRequestPayload, normalizeDrinkName, parseBeverageRequestDrinks } from '../utils/beverageRequests';

const MAX_BEVERAGES = 5;

const StaffBeverageManagement = ({ onBack }) => {
    const [users, setUsers] = useState([]);
    const [requestsByUserId, setRequestsByUserId] = useState({});
    const [draftInputs, setDraftInputs] = useState({});
    const [expandedUser, setExpandedUser] = useState(null);
    const [selectedBranch, setSelectedBranch] = useState('망미점');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false);
    const [savingUserId, setSavingUserId] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const branches = BRANCH_OPTIONS.filter((branch) => branch !== '전체');

    const fetchUsersAndRequests = async () => {
        setLoading(true);
        try {
            const { data: userData, error: userError } = await supabase
                .from('authorized_users')
                .select('id, name, seat_number, branch')
                .eq('branch', selectedBranch)
                .order('seat_number', { ascending: true, nullsFirst: false });

            if (userError) throw userError;

            const sortedUsers = (userData || []).sort((a, b) => {
                if (a.seat_number && b.seat_number) return a.seat_number - b.seat_number;
                if (a.seat_number) return -1;
                if (b.seat_number) return 1;
                return (a.name || '').localeCompare(b.name || '', 'ko');
            });

            setUsers(sortedUsers);

            if (sortedUsers.length === 0) {
                setRequestsByUserId({});
                return;
            }

            const userIds = sortedUsers.map((user) => user.id);
            const { data: requestData, error: requestError } = await supabase
                .from('new_beverage_requests')
                .select('user_id, beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler, request_note, updated_at')
                .in('user_id', userIds);

            if (requestError) throw requestError;

            const nextRequests = {};
            (requestData || []).forEach((request) => {
                nextRequests[request.user_id] = request;
            });
            setRequestsByUserId(nextRequests);
        } catch (error) {
            console.error('Error fetching beverage management data:', error);
            alert('음료 데이터를 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsersAndRequests();
    }, [selectedBranch]);

    useEffect(() => {
        const requestChannel = supabase
            .channel('staff_beverage_management_new_requests')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'new_beverage_requests' }, fetchUsersAndRequests)
            .subscribe();

        const userChannel = supabase
            .channel('staff_beverage_management_users')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'authorized_users' }, fetchUsersAndRequests)
            .subscribe();

        return () => {
            requestChannel.unsubscribe();
            userChannel.unsubscribe();
        };
    }, [selectedBranch]);

    const getDrinkNames = (request) => parseBeverageRequestDrinks(request).slice(0, MAX_BEVERAGES);

    const saveRequest = async (userId, drinkNames, note) => {
        setSavingUserId(userId);
        try {
            const payload = buildBeverageRequestPayload(userId, drinkNames, note);
            const { error } = await supabase
                .from('new_beverage_requests')
                .upsert(payload, { onConflict: 'user_id' });

            if (error) throw error;
            setRequestsByUserId((prev) => ({ ...prev, [userId]: { ...(prev[userId] || {}), ...payload } }));
        } catch (error) {
            console.error('Error saving beverage request:', error);
            alert(`저장 실패: ${error.message || JSON.stringify(error)}`);
        } finally {
            setSavingUserId(null);
        }
    };

    const handleAddDrink = async (userId) => {
        const values = String(draftInputs[userId] || '')
            .split(',')
            .map(normalizeDrinkName)
            .filter(Boolean);
        if (values.length === 0) return;

        const currentRequest = requestsByUserId[userId];
        const nextDrinks = Array.from(new Set([...getDrinkNames(currentRequest), ...values])).slice(0, MAX_BEVERAGES);
        await saveRequest(userId, nextDrinks, currentRequest?.request_note || '');
        setDraftInputs((prev) => ({ ...prev, [userId]: '' }));
    };

    const handleRemoveDrink = async (userId, drinkName) => {
        const currentRequest = requestsByUserId[userId];
        const nextDrinks = getDrinkNames(currentRequest).filter((name) => name !== drinkName);
        await saveRequest(userId, nextDrinks, currentRequest?.request_note || '');
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchUsersAndRequests();
        setRefreshing(false);
    };

    const filteredUsers = users.filter((user) => {
        if (!searchTerm.trim()) return true;
        return String(user.name || '').includes(searchTerm.trim());
    });

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                    <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', marginLeft: '-8px', borderRadius: '50%', display: 'flex' }}>
                        <ChevronLeft size={26} color="#2d3748" />
                    </button>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: '0 0 0 4px', lineHeight: 1 }}>음료 관리</h2>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        background: refreshing ? '#cbd5e0' : '#267E82',
                        border: 'none',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.86rem',
                        cursor: refreshing ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        whiteSpace: 'nowrap'
                    }}
                >
                    <RefreshCw size={16} />
                    {refreshing ? '새로고침 중' : '새로고침'}
                </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '15px' }}>
                <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {branches.map((branch) => (
                        <button
                            key={branch}
                            onClick={() => setSelectedBranch(branch)}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '20px',
                                border: selectedBranch === branch ? 'none' : '1px solid #e2e8f0',
                                background: selectedBranch === branch ? 'var(--color-primary)' : 'white',
                                color: selectedBranch === branch ? 'white' : '#718096',
                                fontSize: '0.85rem',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {branch}
                        </button>
                    ))}
                </div>
                <div style={{ position: 'relative', marginLeft: 'auto' }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#a0aec0' }} />
                    <input
                        type="text"
                        placeholder="이름 검색"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        style={{
                            padding: '6px 10px 6px 30px',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0',
                            fontSize: '0.9rem',
                            outline: 'none',
                            width: '105px',
                            background: '#f7fafc'
                        }}
                    />
                </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '20px' }}>로딩 중...</div>
                ) : filteredUsers.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '20px' }}>
                        {searchTerm ? '검색된 사원이 없습니다.' : '등록된 사원이 없습니다.'}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {filteredUsers.map((user) => {
                            const request = requestsByUserId[user.id];
                            const drinkNames = getDrinkNames(request);
                            const note = request?.request_note || '';
                            const isExpanded = expandedUser === user.id;
                            const isSaving = savingUserId === user.id;
                            const summary = drinkNames.length > 0 ? drinkNames.join(', ') : '입력 없음';

                            return (
                                <div key={user.id} style={{
                                    background: 'white',
                                    borderRadius: '12px',
                                    border: isExpanded ? '1px solid #3182ce' : '1px solid #e2e8f0',
                                    overflow: 'hidden',
                                    transition: 'all 0.2s'
                                }}>
                                    <div
                                        onClick={() => setExpandedUser(isExpanded ? null : user.id)}
                                        style={{
                                            padding: '12px 15px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            cursor: 'pointer',
                                            background: isExpanded ? '#ebf8ff' : 'white'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', minWidth: 0 }}>
                                            <div style={{
                                                width: '28px',
                                                height: '28px',
                                                background: '#bee3f8',
                                                color: '#2b6cb0',
                                                borderRadius: '8px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontWeight: 'bold',
                                                fontSize: '0.9rem',
                                                flexShrink: 0
                                            }}>
                                                {user.seat_number || '-'}
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 'bold', color: '#2d3748' }}>{user.name}</div>
                                                {!isExpanded && (
                                                    <div style={{ marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        <div style={{ fontSize: '0.85rem', color: drinkNames.length > 0 ? '#718096' : '#a0aec0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {summary}
                                                        </div>
                                                        {note && (
                                                            <div style={{ fontSize: '0.82rem', color: '#2c5282', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                참고사항: {note}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {isExpanded ? <ChevronUp size={20} color="#3182ce" /> : <ChevronDown size={20} color="#cbd5e0" />}
                                    </div>

                                    {isExpanded && (
                                        <div style={{ padding: '15px', borderTop: '1px solid #e2e8f0', background: '#fcfcfc' }}>
                                            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#4a5568', marginBottom: '10px' }}>음료 입력</div>
                                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                                                <input
                                                    value={draftInputs[user.id] || ''}
                                                    onChange={(event) => setDraftInputs((prev) => ({ ...prev, [user.id]: event.target.value }))}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter') handleAddDrink(user.id);
                                                    }}
                                                    placeholder="음료명을 입력하세요"
                                                    disabled={isSaving || drinkNames.length >= MAX_BEVERAGES}
                                                    style={{
                                                        flex: 1,
                                                        minWidth: 0,
                                                        padding: '10px',
                                                        borderRadius: '8px',
                                                        border: '1px solid #cbd5e0',
                                                        fontSize: '0.95rem',
                                                        background: drinkNames.length >= MAX_BEVERAGES ? '#edf2f7' : 'white',
                                                        outline: 'none'
                                                    }}
                                                />
                                                <button
                                                    onClick={() => handleAddDrink(user.id)}
                                                    disabled={isSaving || drinkNames.length >= MAX_BEVERAGES}
                                                    style={{
                                                        width: '42px',
                                                        borderRadius: '8px',
                                                        border: 'none',
                                                        background: isSaving || drinkNames.length >= MAX_BEVERAGES ? '#cbd5e0' : '#3182ce',
                                                        color: 'white',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        cursor: isSaving || drinkNames.length >= MAX_BEVERAGES ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    <Plus size={20} />
                                                </button>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                                {drinkNames.length === 0 ? (
                                                    <div style={{ color: '#a0aec0', fontSize: '0.88rem', padding: '8px 0' }}>입력된 음료가 없습니다.</div>
                                                ) : (
                                                    drinkNames.map((name, index) => (
                                                        <div key={`${name}_${index}`} style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            gap: '8px',
                                                            padding: '9px 10px',
                                                            background: 'white',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '8px'
                                                        }}>
                                                            <span style={{ color: '#2d3748', fontWeight: '600', wordBreak: 'break-word' }}>
                                                                {index + 1}. {name}
                                                            </span>
                                                            <button
                                                                onClick={() => handleRemoveDrink(user.id, name)}
                                                                disabled={isSaving}
                                                                style={{
                                                                    background: '#fff5f5',
                                                                    border: 'none',
                                                                    borderRadius: '6px',
                                                                    color: '#e53e3e',
                                                                    padding: '6px',
                                                                    cursor: isSaving ? 'not-allowed' : 'pointer',
                                                                    display: 'flex'
                                                                }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>

                                            {note && (
                                                <div style={{
                                                    marginTop: '12px',
                                                    padding: '10px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #bee3f8',
                                                    background: '#ebf8ff',
                                                    color: '#2c5282',
                                                    fontSize: '0.88rem',
                                                    lineHeight: 1.45,
                                                    wordBreak: 'break-word'
                                                }}>
                                                    <div style={{ fontWeight: '800', marginBottom: '4px' }}>참고사항</div>
                                                    <div>{note}</div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default StaffBeverageManagement;
