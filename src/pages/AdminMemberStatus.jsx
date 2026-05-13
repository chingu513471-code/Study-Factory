import React, { useState, useEffect } from 'react';
import { ChevronLeft, Trash2, Edit2, Save, X, Search, Plus } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { BRANCH_OPTIONS, BRANCH_LIST } from '../constants/branches';

const AdminMemberStatus = ({ onBack }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({
        branch: '',
        role: '',
        seat_number: ''
    });
    const [selectedBranch, setSelectedBranch] = useState('전체');
    const [searchTerm, setSearchTerm] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    // Certificate States
    const [certOptions, setCertOptions] = useState([]);
    const [newCertInput, setNewCertInput] = useState('');
    const [activeUserCerts, setActiveUserCerts] = useState([]); // Certs for the user currently being edited

    const branches = BRANCH_OPTIONS;

    useEffect(() => {
        fetchUsers();
        fetchCertOptions();

        // Real-time subscriptions
        const profilesChannel = supabase
            .channel('admin_profiles_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'authorized_users'
            }, () => {
                fetchUsers();
            })
            .subscribe();

        const certsChannel = supabase
            .channel('user_certs_changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'user_certificates'
            }, () => {
                fetchUsers();
            })
            .subscribe();

        return () => {
            profilesChannel.unsubscribe();
            certsChannel.unsubscribe();
        };
    }, []);

    const fetchCertOptions = async () => {
        const { data } = await supabase.from('certificate_options').select('*').order('name');
        setCertOptions(data || []);
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            // 1. Fetch Users
            const [usersRes, pendingRes] = await Promise.all([
                supabase.from('authorized_users').select('*').order('name', { ascending: true }),
                supabase.from('pending_registrations').select('*').is('linked_user_id', null).order('name', { ascending: true })
            ]);

            if (usersRes.error) throw usersRes.error;
            if (pendingRes.error) throw pendingRes.error;

            // 2. Fetch User Certificates
            const { data: certsData } = await supabase
                .from('user_certificates')
                .select('user_id, certificate_id, certificate_options(id, name)');

            const certMap = {};
            if (certsData) {
                certsData.forEach(item => {
                    if (!certMap[item.user_id]) certMap[item.user_id] = [];
                    if (item.certificate_options) {
                        certMap[item.user_id].push({
                            id: item.certificate_options.id,
                            name: item.certificate_options.name
                        });
                    }
                });
            }

            const activeUsers = (usersRes.data || []).map(u => ({ ...u, type: 'active', certificates: certMap[u.id] || [] }));
            const pendingUsers = (pendingRes.data || []).map(u => ({ ...u, type: 'pending', certificates: [] })); // Pending users don't have certs yet usually

            // Merge and sort by Name
            const allUsers = [...activeUsers, ...pendingUsers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
            setUsers(allUsers);
        } catch (error) {
            console.error('Error fetching users:', error);
            alert('사원 목록을 불러오지 못했습니다.');
        } finally {
            setLoading(false);
        }
    };

    const tryDeleteUserCompletely = async (id) => (
        supabase.rpc('delete_user_completely', { target_user_id: id })
    );

    const isSuggestionsForeignKeyError = (error) => {
        const message = `${error?.message || ''} ${error?.details || ''}`;
        return message.includes('suggestions_user_id_fkey') || (
            message.includes('violates foreign key constraint') &&
            message.includes('"suggestions"')
        );
    };

    const handleDelete = async (id, name, type) => {
        if (type === 'pending') {
            if (!window.confirm(`${name} (가입대기) 님을 삭제하시겠습니까?`)) return;
            try {
                const { error } = await supabase.from('pending_registrations').delete().eq('id', id);
                if (error) throw error;
                fetchUsers();
                alert('삭제되었습니다.');
            } catch (e) {
                console.error('Delete pending error:', e);
                alert(`삭제 실패: ${e.message}`);
            }
            return;
        }

        if (!window.confirm(`${name} 님을 정말 삭제하시겠습니까?\n삭제 후에는 로그인이 불가능하며, 계정 정보가 완전히 제거됩니다.`)) return;

        try {
            const { error } = await tryDeleteUserCompletely(id);

            if (error) {
                if (!isSuggestionsForeignKeyError(error)) throw error;

                const { error: cleanupError } = await supabase
                    .from('suggestions')
                    .delete()
                    .eq('user_id', id);

                if (cleanupError) throw cleanupError;

                const { error: retryError } = await tryDeleteUserCompletely(id);
                if (retryError) throw retryError;
            }

            fetchUsers();
            alert('삭제되었습니다.');
        } catch (error) {
            console.error('Delete error:', error);
            alert(`삭제에 실패했습니다.\n${error.message}`);
        }
    };

    const startEdit = (user) => {
        setEditingId(user.id);
        setActiveUserCerts(user.certificates || []);
        setEditForm({
            branch: user.branch,
            role: user.role,
            seat_number: user.seat_number || ''
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setActiveUserCerts([]);
        setNewCertInput('');
    };

    const saveEdit = async (id) => {
        try {
            const seatNum = editForm.seat_number === '미지정' || editForm.seat_number === ''
                ? null
                : parseInt(editForm.seat_number, 10);

            const { data, error } = await supabase.rpc('update_employee_info', {
                target_id: id,
                new_branch: editForm.branch,
                new_role: editForm.role,
                new_seat_number: seatNum
            });

            if (error) throw error;

            setEditingId(null);
            await fetchUsers();
            alert('수정되었습니다.');
        } catch (error) {
            console.error('Update error:', error);
            alert(`수정에 실패했습니다.\n사유: ${error.message}`);
        }
    };

    // Certificate Handlers
    const handleAddCert = async (userId) => {
        if (!newCertInput.trim()) return;
        try {
            const { data: certId, error } = await supabase.rpc('assign_user_certificate', {
                target_user_id: userId,
                cert_name: newCertInput.trim()
            });

            if (error) throw error;

            // Optimistic update
            const newCert = { id: certId, name: newCertInput.trim() }; // Note: RPC returns UUID, but we might not get name if it existed, so fetching is safer, but for now assuming
            // Actually assign_user_certificate returns ID. We need name.
            // Let's refetch or just assume name is correct.

            // To be safe, let's just refresh the user list or fetch the cert options again to get ID/Name pair if needed.
            // But to be smooth, I'll update local state.

            await fetchUsers(); // Simple refresh to ensure syncing
            await fetchCertOptions(); // Update options list
            setNewCertInput('');

            // Update activeUserCerts based on the refresh (fetchUsers updates `users` state, but we need to update activeUserCerts too if we are still editing)
            // But fetchUsers is async.
            // Let's Just rely on fetchUsers updating `users` and if `editingId` matches, we update `activeUserCerts`.
            // Wait, `activeUserCerts` is local state. We should sync it.

            // Re-find user
            // We'll trust fetchUsers to run. We need to reset activeUserCerts though.
            // See useEffect below.
        } catch (e) {
            console.error(e);
            alert('자격증 추가 실패');
        }
    };

    // Effect to sync users -> activeUserCerts when users update while editing
    useEffect(() => {
        if (editingId) {
            const user = users.find(u => u.id === editingId);
            if (user) setActiveUserCerts(user.certificates || []);
        }
    }, [users, editingId]);


    const handleRemoveCert = async (userId, certId) => {
        if (!confirm('자격증을 삭제하시겠습니까?')) return;
        try {
            const { error } = await supabase.rpc('remove_user_certificate', {
                target_user_id: userId,
                cert_id_param: certId
            });
            if (error) throw error;
            fetchUsers();
        } catch (e) {
            console.error(e);
            alert('삭제 실패');
        }
    };

    // Quick Add from Options
    const handleSelectCert = async (userId, certName) => {
        if (!certName) return;
        try {
            // Reuse the assign RPC
            const { error } = await supabase.rpc('assign_user_certificate', {
                target_user_id: userId,
                cert_name: certName
            });
            if (error) throw error;
            setNewCertInput(''); // Clear if typed
            fetchUsers();
        } catch (e) {
            console.error(e);
            alert('추가 실패');
        }
    };

    const getRoleLabel = (role) => {
        switch (role) {
            case 'admin': return '관리자';
            case 'staff': return '스탭';
            default: return '회원';
        }
    };

    const getRoleColor = (role) => {
        switch (role) {
            case 'admin': return '#e53e3e'; // Red
            case 'staff': return '#805ad5'; // Purple
            default: return '#3182ce'; // Blue
        }
    };

    const filteredUsers = users.filter(user => {
        const branchMatch = selectedBranch === '전체' || user.branch === selectedBranch;
        const nameMatch = !searchTerm.trim() || user.name.toLowerCase().includes(searchTerm.toLowerCase());
        return branchMatch && nameMatch;
    });

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: '20px',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                        onClick={onBack}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
                            marginLeft: '-8px', borderRadius: '50%', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', color: '#2d3748'
                        }}
                    >
                        <ChevronLeft size={26} />
                    </button>
                    <h2 style={{ fontSize: '1.3rem', fontWeight: 'bold', margin: '0 0 0 4px', lineHeight: 1 }}>사원 현황</h2>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Search & Filter */}
                    {isSearchOpen ? (
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
                            padding: '8px 12px'
                        }}>
                            <Search size={16} color="#a0aec0" style={{ marginRight: '6px', flexShrink: 0 }} />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="이름 검색"
                                style={{ border: 'none', outline: 'none', fontSize: '0.9rem', width: '70px', color: '#4a5568' }}
                                autoFocus
                                onBlur={() => { if (!searchTerm) setIsSearchOpen(false); }}
                            />
                            {searchTerm && (
                                <button onClick={() => { setSearchTerm(''); setIsSearchOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                                    <X size={14} color="#a0aec0" />
                                </button>
                            )}
                        </div>
                    ) : (
                        <button onClick={() => setIsSearchOpen(true)} style={{
                            background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
                            padding: '8px 12px', fontSize: '0.9rem', color: '#4a5568',
                            display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'
                        }}>
                            <Search size={16} color="#718096" />
                            <span>이름 검색</span>
                        </button>
                    )}
                    <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        style={{
                            padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0',
                            fontSize: '0.9rem', color: '#4a5568', backgroundColor: 'white',
                            outline: 'none', cursor: 'pointer'
                        }}
                    >
                        {branches.map(branch => (
                            <option key={branch} value={branch}>{branch === '전체' ? '전체 지점' : branch}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* List */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto' }}>
                {loading && <div style={{ textAlign: 'center', color: '#a0aec0' }}>로딩 중...</div>}
                {!loading && filteredUsers.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#a0aec0', marginTop: '50px' }}>
                        {selectedBranch === '전체' ? '등록된 사원이 없습니다.' : '해당 지점에 사원이 없습니다.'}
                    </div>
                )}

                {filteredUsers.map(user => (
                    <div key={user.id} style={{
                        background: 'white', borderRadius: '16px', padding: '15px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0'
                    }}>
                        {editingId === user.id ? (
                            // Edit Mode
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {/* Header (Name & Save/Cancel) */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{user.name}</span>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <button onClick={() => saveEdit(user.id)} style={{ padding: '8px', background: '#38a169', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><Save size={18} /></button>
                                        <button onClick={cancelEdit} style={{ padding: '8px', background: '#e2e8f0', color: '#4a5568', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><X size={18} /></button>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>지점</label>
                                        <select value={editForm.branch} onChange={(e) => setEditForm({ ...editForm, branch: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }}>
                                            {BRANCH_LIST.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>구분</label>
                                        <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }}>
                                            <option value="member">회원</option>
                                            <option value="staff">스탭</option>
                                            <option value="admin">관리자</option>
                                        </select>
                                    </div>
                                </div>
                                {/* Seat */}
                                <div>
                                    <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '4px' }}>좌석 (망미점 1~102)</label>
                                    <select value={editForm.seat_number || '미지정'} onChange={(e) => setEditForm({ ...editForm, seat_number: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0' }} disabled={editForm.branch !== '망미점'}>
                                        <option value="미지정">미지정</option>
                                        {editForm.branch === '망미점' && Array.from({ length: 102 }, (_, i) => i + 1).map(num => (<option key={num} value={num}>{num}번</option>))}
                                    </select>
                                </div>

                                {/* Certificates */}
                                <div style={{ padding: '10px', background: '#f7fafc', borderRadius: '8px', border: '1px solid #edf2f7' }}>
                                    <label style={{ fontSize: '0.8rem', color: '#718096', display: 'block', marginBottom: '8px' }}>준비 자격증</label>

                                    {/* Existing Certs Chips */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                                        {activeUserCerts.map(cert => (
                                            <div key={cert.id} style={{
                                                display: 'flex', alignItems: 'center', gap: '4px',
                                                background: 'white', border: '1px solid #cbd5e0',
                                                padding: '4px 8px', borderRadius: '15px', fontSize: '0.85rem'
                                            }}>
                                                <span>{cert.name}</span>
                                                <button onClick={() => handleRemoveCert(user.id, cert.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: '#e53e3e' }}>
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Add Cert */}
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <div style={{ position: 'relative', flex: 1 }}>
                                            <input
                                                type="text"
                                                value={newCertInput}
                                                onChange={(e) => setNewCertInput(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleAddCert(user.id);
                                                }}
                                                onFocus={(e) => {
                                                    // This helps some browsers show the list more easily
                                                    e.target.setAttribute('placeholder', '입력하거나 선택하세요');
                                                }}
                                                placeholder="자격증 입력 or 선택"
                                                list="cert-options"
                                                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e0', fontSize: '0.9rem' }}
                                            />
                                            <datalist id="cert-options">
                                                {certOptions.map(opt => (
                                                    <option key={opt.id} value={opt.name} />
                                                ))}
                                            </datalist>
                                        </div>
                                        <button
                                            onClick={() => handleAddCert(user.id)}
                                            style={{
                                                background: '#3182ce', color: 'white', border: 'none',
                                                borderRadius: '8px', padding: '0 12px', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center'
                                            }}
                                        >
                                            <Plus size={18} />
                                        </button>
                                    </div>
                                </div>

                                <div style={{ fontSize: '0.82rem', color: '#718096', lineHeight: 1.5 }}>
                                    음료는 스탭 대시보드의 사원 음료 관리에서 수정하면 회원 음료 신청 페이지와 제조표에 같이 반영됩니다.
                                </div>
                            </div>
                        ) : (
                            // View Mode
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2d3748' }}>{user.name}</span>
                                        {user.type === 'pending' && <span style={{ fontSize: '0.8rem', color: '#e53e3e', background: '#fff5f5', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>가입대기중</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '0.85rem', color: '#718096' }}>{user.branch}</span>
                                        <span style={{ width: '1px', height: '12px', background: '#cbd5e0' }}></span>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: getRoleColor(user.role) }}>{getRoleLabel(user.role)}</span>
                                        {(user.seat_number || (user.type === 'pending' && user.seat_number)) && (
                                            <>
                                                <span style={{ width: '1px', height: '12px', background: '#cbd5e0' }}></span>
                                                <span style={{ fontSize: '0.85rem', color: '#2b6cb0', fontWeight: 'bold' }}>좌석 {user.seat_number}번</span>
                                            </>
                                        )}
                                    </div>

                                    {/* Certificates Display */}
                                    {user.certificates && user.certificates.length > 0 && (
                                        <div style={{ marginTop: '5px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                            {user.certificates.map(cert => (
                                                <span key={cert.id} style={{
                                                    fontSize: '0.75rem', background: '#ebf8ff', color: '#2b6cb0',
                                                    padding: '2px 6px', borderRadius: '4px', fontWeight: '500'
                                                }}>
                                                    {cert.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {user.memo && (
                                        <div style={{ fontSize: '0.85rem', color: '#718096', marginTop: '4px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {user.memo}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    {user.type === 'active' && (
                                        <button onClick={() => startEdit(user)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', color: '#718096' }}><Edit2 size={20} /></button>
                                    )}
                                    <button onClick={() => handleDelete(user.id, user.name, user.type)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '5px', color: '#e53e3e' }}><Trash2 size={20} /></button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div >
        </div >
    );
};

export default AdminMemberStatus;
