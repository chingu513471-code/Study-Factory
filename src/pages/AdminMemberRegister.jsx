import React, { useState, useEffect } from 'react';
import { ChevronLeft, Trash2, Edit2, Save, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { BRANCH_LIST } from '../constants/branches';

const AdminMemberRegister = ({ onBack }) => {
    console.log('AdminMemberRegister mounting');
    const [name, setName] = useState('');
    const [branch, setBranch] = useState('망미점');
    const [role, setRole] = useState('member'); // Default to member
    const [seatNumber, setSeatNumber] = useState('');
    const [beverageDrinks, setBeverageDrinks] = useState('');
    const [beverageNote, setBeverageNote] = useState('');
    const [memo, setMemo] = useState('');
    const [expectedStartDate, setExpectedStartDate] = useState('');
    const [targetCertificate, setTargetCertificate] = useState('');

    const [list, setList] = useState([]);
    const [certOptions, setCertOptions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Edit pending registration state
    const [editingPendingId, setEditingPendingId] = useState(null);
    const [editPendingForm, setEditPendingForm] = useState({});

    const branches = BRANCH_LIST;

    useEffect(() => {
        fetchList();
        fetchCertOptions();

        // Real-time subscriptions
        const profilesChannel = supabase
            .channel('profiles_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'profiles'
            }, () => {
                fetchList();
            })
            .subscribe();

        const pendingChannel = supabase
            .channel('pending_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'pending_registrations'
            }, () => {
                fetchList();
            })
            .subscribe();

        return () => {
            profilesChannel.unsubscribe();
            pendingChannel.unsubscribe();
        };
    }, []);

    const fetchCertOptions = async () => {
        try {
            const { data } = await supabase.from('certificate_options').select('*').order('name');
            setCertOptions(data || []);
        } catch (e) { console.error('Error fetching certificate options:', e); }
    };

    const fetchList = async () => {
        try {
            // pending_registrations 테이블에서 대기 중인 사용자 목록 조회
            const { data, error } = await supabase
                .from('pending_registrations')
                .select('*')
                .is('linked_user_id', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setList(data || []);
        } catch (err) {
            console.error('Error fetching list:', err);
        }
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setLoading(true);
        setError('');

        try {
            // Check for duplicates in pending_registrations
            const { data: pendingExisting } = await supabase
                .from('pending_registrations')
                .select('id')
                .eq('name', name.trim())
                .single();

            if (pendingExisting) {
                setError('이미 등록 대기 중인 이름입니다.');
                setLoading(false);
                return;
            }

            // Also check if already registered in profiles
            const { data: registeredExisting } = await supabase
                .from('profiles')
                .select('id')
                .eq('name', name.trim())
                .single();

            if (registeredExisting) {
                setError('이미 가입된 사용자입니다.');
                setLoading(false);
                return;
            }

            // Insert into pending_registrations table
            const { data, error } = await supabase
                .from('pending_registrations')
                .insert([{
                    name: name.trim(),
                    branch,
                    role,
                    seat_number: seatNumber ? parseInt(seatNumber) : null,
                    beverage_drinks: beverageDrinks.trim() || null,
                    beverage_note: beverageNote.trim() || null,
                    memo: memo.trim() || null,
                    expected_start_date: expectedStartDate || null,
                    target_certificate: targetCertificate.trim() || null
                }])
                .select()
                .single();

            if (error) throw error;

            // Auto-create Staff Todos
            if (data) {
                // Use expected_start_date if provided, otherwise use current date
                const dateObj = expectedStartDate ? new Date(expectedStartDate) : new Date();
                const month = dateObj.getMonth() + 1;
                const date = dateObj.getDate();
                const shortDate = `${month}/${date}`;

                const todoContentPrefix = `${shortDate} ${seatNumber ? `${seatNumber}번` : ''} ${name.trim()}${targetCertificate.trim() ? ` ${targetCertificate.trim()}` : ''}`;
                const todos = [
                    `${todoContentPrefix} 명패 준비`,
                    `${todoContentPrefix} 책상 정비`,
                    `${todoContentPrefix} 좌석 및 음료 정보 입력 확인`,
                    `${todoContentPrefix} 이름스티커 준비`
                ];

                // Fetch user ID for created_by
                const { data: { user } } = await supabase.auth.getUser();

                const { error: todoError } = await supabase.from('staff_todos').insert(todos.map(content => ({
                    content,
                    branch,
                    pending_registration_id: data.id,
                    created_by: user?.id
                })));

                if (todoError) console.error("Auto todo creation failed", todoError);
            }

            if (error) throw error;

            setName('');
            setSeatNumber('');
            setBeverageDrinks('');
            setBeverageNote('');
            setMemo('');
            setExpectedStartDate('');
            setTargetCertificate('');
            fetchList();
        } catch (err) {
            console.error('Add error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('정말 삭제하시겠습니까?')) return;
        try {
            const { error } = await supabase
                .from('pending_registrations')
                .delete()
                .eq('id', id);

            if (error) throw error;
            fetchList();
        } catch (err) {
            console.error('Delete error:', err);
            alert(`삭제 실패: ${err.message}`);
        }
    };

    const startEditPending = (user) => {
        setEditingPendingId(user.id);
        setEditPendingForm({
            name: user.name,
            branch: user.branch,
            role: user.role,
            seat_number: user.seat_number || '',
            expected_start_date: user.expected_start_date || '',
            target_certificate: user.target_certificate || '',
            beverage_drinks: user.beverage_drinks || '',
            beverage_note: user.beverage_note || '',
            memo: user.memo || ''
        });
    };

    const cancelEditPending = () => {
        setEditingPendingId(null);
        setEditPendingForm({});
    };

    const saveEditPending = async (id) => {
        try {
            const seatNum = editPendingForm.seat_number === '미지정' || editPendingForm.seat_number === ''
                ? null
                : parseInt(editPendingForm.seat_number, 10);

            // Update pending_registrations
            const { error } = await supabase
                .from('pending_registrations')
                .update({
                    name: editPendingForm.name,
                    branch: editPendingForm.branch,
                    role: editPendingForm.role,
                    seat_number: seatNum,
                    expected_start_date: editPendingForm.expected_start_date || null,
                    target_certificate: editPendingForm.target_certificate || null,
                    beverage_drinks: editPendingForm.beverage_drinks || null,
                    beverage_note: editPendingForm.beverage_note || null,
                    memo: editPendingForm.memo || null
                })
                .eq('id', id);

            if (error) throw error;

            // Update linked staff_todos content
            const dateObj = editPendingForm.expected_start_date ? new Date(editPendingForm.expected_start_date) : new Date();
            const month = dateObj.getMonth() + 1;
            const date = dateObj.getDate();
            const shortDate = `${month}/${date}`;
            const todoPrefix = `${shortDate} ${seatNum ? `${seatNum}번` : ''} ${editPendingForm.name}${editPendingForm.target_certificate ? ` ${editPendingForm.target_certificate}` : ''}`;

            // Fetch and update todos
            const { data: todos } = await supabase
                .from('staff_todos')
                .select('*')
                .eq('pending_registration_id', id);

            if (todos && todos.length > 0) {
                const tasks = ['명패 준비', '책상 정비', '좌석 및 음료 정보 입력 확인', '이름스티커 준비'];
                for (let i = 0; i < todos.length; i++) {
                    await supabase
                        .from('staff_todos')
                        .update({
                            content: `${todoPrefix} ${tasks[i] || ''}`,
                            branch: editPendingForm.branch
                        })
                        .eq('id', todos[i].id);
                }
            }

            setEditingPendingId(null);
            setEditPendingForm({});
            await fetchList();
            alert('수정되었습니다.');
        } catch (error) {
            console.error('Update error:', error);
            alert(`수정에 실패했습니다.\n사유: ${error.message}`);
        }
    };

    return (
        <div style={{ height: '100%', overflowY: 'auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
                <button
                    onClick={onBack}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px',
                        marginLeft: '-8px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#2d3748'
                    }}
                >
                    <ChevronLeft size={26} />
                </button>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 'bold', margin: '0 0 0 4px', lineHeight: 1 }}>사원 사전 등록</h2>
            </div>

            {/* Form */}
            <form onSubmit={handleAdd} style={{ marginBottom: '30px', background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '15px' }}>
                    <div style={{ minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>지점</label>
                        <select
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '1rem', background: 'white' }}
                        >
                            {branches.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>사원 구분</label>
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '1rem', background: 'white' }}
                        >
                            <option value="member">회원</option>
                            <option value="staff">스탭</option>
                            <option value="admin">관리자</option>
                        </select>
                    </div>
                </div>

                <div style={{ marginBottom: '15px', display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '10px' }}>
                    <div style={{ minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>이름 (로그인 ID)</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="이름을 입력하여 주세요."
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '1rem', fontWeight: 'bold' }}
                        />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>좌석 번호</label>
                        <input
                            type="number"
                            value={seatNumber}
                            onChange={(e) => setSeatNumber(e.target.value)}
                            placeholder="번호"
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '1rem' }}
                        />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '15px' }}>
                    <div style={{ minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>입사예정일</label>
                        <input
                            type="date"
                            value={expectedStartDate}
                            onChange={(e) => setExpectedStartDate(e.target.value)}
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '1rem' }}
                        />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>명패 내용</label>
                        <input
                            type="text"
                            value={targetCertificate}
                            onChange={(e) => setTargetCertificate(e.target.value)}
                            placeholder="명패 문구 입력 또는 선택"
                            list="cert-options-list"
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '1rem' }}
                        />
                        <datalist id="cert-options-list">
                            {certOptions.map(opt => (
                                <option key={opt.id} value={opt.name} />
                            ))}
                        </datalist>
                    </div>
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>음료 설정 (선택사항)</label>
                    <input
                        type="text"
                        value={beverageDrinks}
                        onChange={(e) => setBeverageDrinks(e.target.value)}
                        placeholder="예: 선식, 텀블러 아아"
                        style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.95rem', marginBottom: '8px' }}
                    />
                    <textarea
                        value={beverageNote}
                        onChange={(e) => setBeverageNote(e.target.value)}
                        placeholder="음료 참고사항"
                        style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.95rem', resize: 'vertical', minHeight: '58px' }}
                    />
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', color: '#718096', marginBottom: '5px' }}>회원 참고사항</label>
                    <textarea
                        value={memo}
                        onChange={(e) => setMemo(e.target.value)}
                        placeholder="참고사항을 입력하세요."
                        style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.95rem', resize: 'vertical', minHeight: '60px' }}
                    />
                </div>

                {error && <div style={{ color: '#e53e3e', fontSize: '0.9rem', marginBottom: '10px' }}>{error}</div>}
                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        width: '100%',
                        padding: '14px',
                        borderRadius: '12px',
                        border: 'none',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        opacity: loading ? 0.7 : 1,
                        boxShadow: '0 4px 6px rgba(118, 75, 162, 0.3)'
                    }}
                >
                    {loading ? '등록 중...' : '등록하기'}
                </button>
            </form>

            {/* List */}
            <h3 style={{ fontSize: '1rem', fontWeight: 'bold', marginBottom: '15px', color: '#4a5568' }}>등록 대기 현황 ({list.length})</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {list.length === 0 && <div style={{ textAlign: 'center', color: '#a0aec0', padding: '20px' }}>대기 중인 인원이 없습니다.</div>}
                {list.map(user => (
                    <div key={user.id} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '15px' }}>
                        {editingPendingId === user.id ? (
                            // Edit Mode
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{user.name} 수정</span>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <button onClick={() => saveEditPending(user.id)} style={{ padding: '8px', background: '#38a169', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><Save size={18} /></button>
                                        <button onClick={cancelEditPending} style={{ padding: '8px', background: '#e2e8f0', color: '#4a5568', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><X size={18} /></button>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>이름</label>
                                        <input value={editPendingForm.name} onChange={(e) => setEditPendingForm({ ...editPendingForm, name: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>지점</label>
                                        <select value={editPendingForm.branch} onChange={(e) => setEditPendingForm({ ...editPendingForm, branch: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }}>
                                            {BRANCH_LIST.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>구분</label>
                                        <select value={editPendingForm.role} onChange={(e) => setEditPendingForm({ ...editPendingForm, role: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }}>
                                            <option value="member">회원</option>
                                            <option value="staff">스탭</option>
                                            <option value="admin">관리자</option>
                                        </select>
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>좌석</label>
                                        <input type="number" value={editPendingForm.seat_number} onChange={(e) => setEditPendingForm({ ...editPendingForm, seat_number: e.target.value })} placeholder="번호" style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }} />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>입사예정일</label>
                                        <input type="date" value={editPendingForm.expected_start_date} onChange={(e) => setEditPendingForm({ ...editPendingForm, expected_start_date: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }} />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>명패 내용</label>
                                        <input type="text" value={editPendingForm.target_certificate} onChange={(e) => setEditPendingForm({ ...editPendingForm, target_certificate: e.target.value })} placeholder="명패 문구" list="cert-options-edit" style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }} />
                                        <datalist id="cert-options-edit">
                                            {certOptions.map(opt => (<option key={opt.id} value={opt.name} />))}
                                        </datalist>
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>메모</label>
                                    <textarea value={editPendingForm.memo} onChange={(e) => setEditPendingForm({ ...editPendingForm, memo: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0', resize: 'vertical', minHeight: '60px' }} />
                                </div>
                            </div>
                        ) : (
                            // View Mode
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#2d3748' }}>{user.name}</div>
                                    <div style={{ fontSize: '0.85rem', color: '#718096' }}>
                                        {user.branch} · <span style={{ color: user.role === 'admin' ? '#e53e3e' : (user.role === 'staff' ? '#805ad5' : '#4299e1'), fontWeight: 'bold' }}>
                                            {user.role === 'admin' ? '관리자' : (user.role === 'staff' ? '스탭' : '회원')}
                                        </span>
                                        {user.seat_number && <span style={{ marginLeft: '6px', color: '#718096' }}>| 좌석 {user.seat_number}</span>}
                                        {user.expected_start_date && (
                                            <span style={{ marginLeft: '6px', color: '#718096' }}>
                                                | 입사예정: {new Date(user.expected_start_date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                                            </span>
                                        )}
                                        {user.target_certificate && (
                                            <div style={{ marginTop: '4px' }}>
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    background: '#ebf8ff',
                                                    color: '#2b6cb0',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    fontWeight: '500'
                                                }}>
                                                    {user.target_certificate}
                                                </span>
                                            </div>
                                        )}
                                        {user.memo && <div style={{ fontSize: '0.8rem', color: '#a0aec0', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{user.memo}</div>}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{ fontSize: '0.8rem', color: '#d69e2e', background: '#fffaf0', padding: '4px 8px', borderRadius: '20px', fontWeight: 'bold' }}>대기중</span>
                                    <button onClick={() => startEditPending(user)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '5px' }}>
                                        <Edit2 size={18} color="#3182ce" />
                                    </button>
                                    <button onClick={() => handleDelete(user.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '5px' }}>
                                        <Trash2 size={18} color="#e53e3e" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AdminMemberRegister;
