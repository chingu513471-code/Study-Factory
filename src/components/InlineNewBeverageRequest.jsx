import React, { useEffect, useState } from 'react';
import { CheckCircle, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { buildBeverageRequestPayload, normalizeDrinkName, parseBeverageRequestDrinks } from '../utils/beverageRequests';

const cardStyle = {
    background: 'white',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    height: '100%',
    overflowY: 'auto',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none'
};

const panelStyle = {
    border: '1px solid #d9e2ec',
    borderRadius: '14px',
    padding: '16px',
    background: '#f8fafc'
};

const InlineNewBeverageRequest = () => {
    const { user } = useAuth();
    const [drinkNames, setDrinkNames] = useState([]);
    const [draftDrink, setDraftDrink] = useState('');
    const [requestNote, setRequestNote] = useState('');
    const [loading, setLoading] = useState(false);

    const fetchMyRequest = async () => {
        if (!user?.id) return;

        try {
            const { data, error } = await supabase
                .from('new_beverage_requests')
                .select('beverage_1_choice, beverage_2_choice, beverage_2_custom, use_personal_tumbler, request_note')
                .eq('user_id', user.id)
                .maybeSingle();

            if (error) throw error;
            setDrinkNames(parseBeverageRequestDrinks(data));
            setRequestNote(data?.request_note || '');
        } catch (error) {
            console.error('Error fetching new beverage request:', error);
        }
    };

    useEffect(() => {
        fetchMyRequest();
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id) return undefined;

        const channel = supabase
            .channel(`member_new_beverage_request_${user.id}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'new_beverage_requests',
                filter: `user_id=eq.${user.id}`
            }, fetchMyRequest)
            .subscribe();

        return () => channel.unsubscribe();
    }, [user?.id]);

    const handleAddDrink = () => {
        const nextItems = draftDrink
            .split(',')
            .map(normalizeDrinkName)
            .filter(Boolean);

        if (nextItems.length === 0) return;
        setDrinkNames((prev) => Array.from(new Set([...prev, ...nextItems])).slice(0, 5));
        setDraftDrink('');
    };

    const handleSubmit = async () => {
        if (!user?.id) {
            alert('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
            return;
        }

        setLoading(true);
        try {
            const payload = buildBeverageRequestPayload(user.id, drinkNames, requestNote);
            const { error } = await supabase
                .from('new_beverage_requests')
                .upsert(payload, { onConflict: 'user_id' });

            if (error) throw error;
            alert('음료 신청이 저장되었습니다.');
        } catch (error) {
            console.error('Error saving new beverage request:', error);
            alert('음료 신청 저장에 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={cardStyle}>
            <style>{'div::-webkit-scrollbar { display: none; }'}</style>

            <p style={{ margin: '0 0 14px 0', fontSize: '1rem', fontWeight: '700', color: '#2d3748', lineHeight: 1.5 }}>
                아침에 서빙해드릴 음료를 자유롭게 입력해주세요.<br />
                언제든 변경할 수 있습니다.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={panelStyle}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: '800', color: '#1f2937' }}>음료</h4>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                        <input
                            value={draftDrink}
                            onChange={(event) => setDraftDrink(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') handleAddDrink();
                            }}
                            placeholder="예: 선식, 텀블러 아아"
                            disabled={drinkNames.length >= 5}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: '11px 12px',
                                borderRadius: '10px',
                                border: '1px solid #cbd5e0',
                                fontSize: '0.95rem',
                                outline: 'none',
                                background: drinkNames.length >= 5 ? '#edf2f7' : 'white'
                            }}
                        />
                        <button
                            type="button"
                            onClick={handleAddDrink}
                            disabled={drinkNames.length >= 5}
                            style={{
                                width: '44px',
                                borderRadius: '10px',
                                border: 'none',
                                background: drinkNames.length >= 5 ? '#cbd5e0' : '#267E82',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: drinkNames.length >= 5 ? 'not-allowed' : 'pointer'
                            }}
                        >
                            <Plus size={20} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {drinkNames.length === 0 ? (
                            <div style={{ color: '#9aa3af', fontSize: '0.9rem' }}>입력된 음료가 없습니다.</div>
                        ) : (
                            drinkNames.map((name, index) => (
                                <div key={`${name}_${index}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '10px', borderRadius: '10px', border: '1px solid #d9e2ec', background: 'white' }}>
                                    <span style={{ color: '#2d3748', fontWeight: '700', wordBreak: 'break-word' }}>{index + 1}. {name}</span>
                                    <button
                                        type="button"
                                        onClick={() => setDrinkNames((prev) => prev.filter((item) => item !== name))}
                                        style={{ border: 'none', background: '#fff5f5', color: '#e53e3e', borderRadius: '8px', padding: '6px', display: 'flex', cursor: 'pointer' }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div style={panelStyle}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: '800', color: '#1f2937' }}>참고사항</h4>
                    <textarea
                        value={requestNote}
                        onChange={(event) => setRequestNote(event.target.value)}
                        placeholder="음료 관련 요청사항이 있을 경우 적어주세요"
                        rows={3}
                        style={{
                            width: '100%',
                            resize: 'vertical',
                            minHeight: '86px',
                            padding: '10px 12px',
                            borderRadius: '10px',
                            border: '1px solid #cbd5e0',
                            fontSize: '0.92rem',
                            outline: 'none',
                            background: 'white'
                        }}
                    />
                </div>
            </div>

            <button
                onClick={handleSubmit}
                disabled={loading}
                style={{
                    marginTop: '18px',
                    width: '100%',
                    padding: '14px',
                    borderRadius: '12px',
                    border: 'none',
                    background: '#267E82',
                    color: 'white',
                    fontSize: '1rem',
                    fontWeight: '800',
                    cursor: loading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                }}
            >
                <CheckCircle size={18} />
                {loading ? '저장 중...' : '저장'}
            </button>
        </div>
    );
};

export default InlineNewBeverageRequest;
