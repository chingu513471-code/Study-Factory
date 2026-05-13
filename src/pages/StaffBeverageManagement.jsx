import React, { useState, useEffect } from 'react';
import { ChevronLeft, Plus, Trash2, Search, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { BRANCH_OPTIONS } from '../constants/branches';

const MAX_BEVERAGES = 5;

const isNoDrink = (value) => ['안먹음', '없음', '안 먹음'].includes(String(value || '').trim());

const normalizeDrinkName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const formatNewRequestBeverages = (request) => {
    const drinks = [];
    const beverage1 = normalizeDrinkName(request.beverage_1_choice);
    if (beverage1 && !isNoDrink(beverage1)) {
        drinks.push(beverage1);
    }

    const beverage2Choice = normalizeDrinkName(request.beverage_2_choice);
    if (beverage2Choice && !isNoDrink(beverage2Choice)) {
        const base = beverage2Choice === '기타'
            ? normalizeDrinkName(request.beverage_2_custom)
            : beverage2Choice;

        if (base && !isNoDrink(base)) {
            drinks.push(request.use_personal_tumbler ? `텀블러 ${base}` : base);
        }
    }

    return Array.from(new Set(drinks)).slice(0, MAX_BEVERAGES);
};

const StaffBeverageManagement = ({ onBack }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [savingUserId, setSavingUserId] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const [selectedBranch, setSelectedBranch] = useState('망미점');
    const [beverageOptions, setBeverageOptions] = useState([]);
    const [userSelections, setUserSelections] = useState({});
    const [requestNotes, setRequestNotes] = useState({});
    const [expandedUser, setExpandedUser] = useState(null);
    const [draftInputs, setDraftInputs] = useState({});
    const [searchTerm, setSearchTerm] = useState('');

    const branches = BRANCH_OPTIONS.filter(b => b !== '전체');

    const filteredUsers = users.filter(user => {
        if (searchTerm && !String(user.name || '').includes(searchTerm)) return false;
        return true;
    });

    useEffect(() => {
        fetchBeverageOptions();
    }, []);

    useEffect(() => {
        fetchUsersAndSelections();
    }, [selectedBranch]);

    const fetchBeverageOptions = async () => {
        try {
            const { data, error } = await supabase
                .from('beverage_options')
                .select('*')
                .order('created_at', { ascending: true });
            if (error) throw error;
            setBeverageOptions(data || []);
        } catch (err) {
            console.error('Error fetching options:', err);
        }
    };

    const fetchUsersAndSelections = async () => {
        setLoading(true);
        try {
            const { data: userData, error: userError } = await supabase
                .from('authorized_users')
                .select('*')
                .eq('branch', selectedBranch)
                .order('seat_number', { ascending: true, nullsFirst: false });

            if (userError) throw userError;

            const sortedUsers = (userData || []).sort((a, b) => {
                const seatA = a.seat_number;
                const seatB = b.seat_number;
                if (seatA && seatB) return seatA - seatB;
                if (seatA) return -1;
                if (seatB) return 1;
                return (a.name || '').localeCompare(b.name || '');
            });
            setUsers(sortedUsers);

            if (sortedUsers.length > 0) {
                const userIds = sortedUsers.map(u => u.id);
                const [{ data: selectionData, error: selectionError }, { data: requestData, error: requestError }] = await Promise.all([
                    supabase
                    .from('user_beverage_selections')
                    .select('*')
                        .in('user_id', userIds),
                    supabase
                        .from('new_beverage_requests')
                        .select('user_id, request_note')
                        .in('user_id', userIds)
                ]);

                if (selectionError) throw selectionError;
                if (requestError) throw requestError;

                const map = {};
                (selectionData || []).forEach(s => {
                    map[s.user_id] = s;
                });
                setUserSelections(map);

                const noteMap = {};
                (requestData || []).forEach(row => {
                    const note = normalizeDrinkName(row.request_note);
                    if (note) noteMap[row.user_id] = note;
                });
                setRequestNotes(noteMap);
            } else {
                setUserSelections({});
                setRequestNotes({});
            }
        } catch (err) {
            console.error('Error fetching data:', err);
        } finally {
            setLoading(false);
        }
    };

    const getBeverageNames = (selection) => {
        if (!selection) return [];
        return Array.from({ length: MAX_BEVERAGES }, (_, index) => {
            const optId = selection[`selection_${index + 1}`];
            const opt = beverageOptions.find(o => o.id === optId);
            return opt?.name || '';
        }).filter(Boolean);
    };

    const ensureBeverageOptions = async (names) => {
        const normalizedNames = Array.from(new Set(names.map(normalizeDrinkName).filter(Boolean)));
        const optionMap = new Map(beverageOptions.map(option => [option.name, option]));
        const createdOptions = [];

        for (const name of normalizedNames) {
            if (optionMap.has(name)) continue;

            const { data, error } = await supabase
                .from('beverage_options')
                .insert([{ name }])
                .select()
                .single();

            if (error) {
                if (String(error.message || '').includes('duplicate')) {
                    const { data: existing, error: fetchError } = await supabase
                        .from('beverage_options')
                        .select('*')
                        .eq('name', name)
                        .single();
                    if (fetchError) throw fetchError;
                    optionMap.set(name, existing);
                    continue;
                }
                throw error;
            }

            optionMap.set(name, data);
            createdOptions.push(data);
        }

        if (createdOptions.length > 0) {
            setBeverageOptions(prev => [...prev, ...createdOptions]);
        }

        return optionMap;
    };

    const saveUserBeverages = async (userId, drinkNames) => {
        const names = Array.from(new Set(drinkNames.map(normalizeDrinkName).filter(Boolean))).slice(0, MAX_BEVERAGES);
        setSavingUserId(userId);

        try {
            const optionMap = await ensureBeverageOptions(names);
            const nextSelection = { user_id: userId };
            for (let i = 1; i <= MAX_BEVERAGES; i++) {
                nextSelection[`selection_${i}`] = names[i - 1] ? optionMap.get(names[i - 1])?.id || null : null;
            }

            const { error } = await supabase
                .from('user_beverage_selections')
                .upsert(nextSelection, { onConflict: 'user_id' });

            if (error) throw error;

            setUserSelections(prev => ({ ...prev, [userId]: { ...(prev[userId] || {}), ...nextSelection } }));
        } catch (err) {
            console.error('Update error:', err);
            alert(`저장 실패: ${err.message || JSON.stringify(err)}`);
        } finally {
            setSavingUserId(null);
        }
    };

    const handleAddDrink = async (userId) => {
        const input = draftInputs[userId] || '';
        const nextNames = input
            .split(',')
            .map(normalizeDrinkName)
            .filter(Boolean);

        if (nextNames.length === 0) return;

        const currentNames = getBeverageNames(userSelections[userId]);
        const merged = Array.from(new Set([...currentNames, ...nextNames])).slice(0, MAX_BEVERAGES);
        await saveUserBeverages(userId, merged);
        setDraftInputs(prev => ({ ...prev, [userId]: '' }));
    };

    const handleRemoveDrink = async (userId, drinkName) => {
        const nextNames = getBeverageNames(userSelections[userId]).filter(name => name !== drinkName);
        await saveUserBeverages(userId, nextNames);
    };

    const handleSyncNewBeverageRequests = async () => {
        if (!confirm('현재 사원 음료 선택값을 모두 비우고, 새로운 음료 신청 데이터로 다시 반영할까요?')) return;

        setSyncing(true);
        try {
            const { data: existingSelections, error: existingError } = await supabase
                .from('user_beverage_selections')
                .select('user_id');
            if (existingError) throw existingError;

            const emptySelectionRows = (existingSelections || []).map(row => {
                const next = { user_id: row.user_id };
                for (let i = 1; i <= MAX_BEVERAGES; i++) next[`selection_${i}`] = null;
                return next;
            });

            if (emptySelectionRows.length > 0) {
                const { error: clearError } = await supabase
                    .from('user_beverage_selections')
                    .upsert(emptySelectionRows, { onConflict: 'user_id' });
                if (clearError) throw clearError;
            }

            const { data: requestRows, error: requestError } = await supabase
                .from('new_beverage_requests')
                .select('user_id, beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler');
            if (requestError) throw requestError;

            const requestsWithDrinks = (requestRows || [])
                .map(row => ({ userId: row.user_id, drinks: formatNewRequestBeverages(row) }))
                .filter(row => row.userId && row.drinks.length > 0);

            const allDrinkNames = requestsWithDrinks.flatMap(row => row.drinks);
            const optionMap = await ensureBeverageOptions(allDrinkNames);
            const syncedRows = requestsWithDrinks.map(row => {
                const next = { user_id: row.userId };
                for (let i = 1; i <= MAX_BEVERAGES; i++) {
                    const name = row.drinks[i - 1];
                    next[`selection_${i}`] = name ? optionMap.get(name)?.id || null : null;
                }
                return next;
            });

            if (syncedRows.length > 0) {
                const { error: syncError } = await supabase
                    .from('user_beverage_selections')
                    .upsert(syncedRows, { onConflict: 'user_id' });
                if (syncError) throw syncError;
            }

            await fetchBeverageOptions();
            await fetchUsersAndSelections();
            alert(`새로운 음료 신청 ${syncedRows.length}건을 반영했습니다.`);
        } catch (err) {
            console.error('Sync error:', err);
            alert(`반영 실패: ${err.message || JSON.stringify(err)}`);
        } finally {
            setSyncing(false);
        }
    };

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
                    onClick={handleSyncNewBeverageRequests}
                    disabled={syncing}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        background: syncing ? '#cbd5e0' : '#267E82',
                        border: 'none',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.86rem',
                        cursor: syncing ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        whiteSpace: 'nowrap'
                    }}
                >
                    <RefreshCw size={16} />
                    {syncing ? '반영 중' : '새 음료신청 반영'}
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
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
                <div style={{ position: 'relative', marginLeft: 'auto' }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#a0aec0' }} />
                    <input
                        type="text"
                        placeholder="이름 검색"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
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
                        {filteredUsers.map(user => {
                            const isExpanded = expandedUser === user.id;
                            const selection = userSelections[user.id] || {};
                            const drinkNames = getBeverageNames(selection);
                            const requestNote = requestNotes[user.id] || '';
                            const summary = drinkNames.length > 0 ? drinkNames.join(', ') : '입력 없음';
                            const isSaving = savingUserId === user.id;

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
                                                width: '28px', height: '28px',
                                                background: '#bee3f8', color: '#2b6cb0',
                                                borderRadius: '8px',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontWeight: 'bold', fontSize: '0.9rem',
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
                                                        {requestNote && (
                                                            <div style={{ fontSize: '0.82rem', color: '#2c5282', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                참고사항: {requestNote}
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
                                                    onChange={(e) => setDraftInputs(prev => ({ ...prev, [user.id]: e.target.value }))}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleAddDrink(user.id);
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
                                                                style={{ background: '#fff5f5', border: 'none', borderRadius: '6px', color: '#e53e3e', padding: '6px', cursor: isSaving ? 'not-allowed' : 'pointer', display: 'flex' }}
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                            {requestNote && (
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
                                                    <div>{requestNote}</div>
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
