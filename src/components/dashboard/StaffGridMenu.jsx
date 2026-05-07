import React, { useState } from 'react';
import { ChevronLeft, Calendar, ClipboardList, UserPlus, UserCheck, MapPin, Coffee } from 'lucide-react';
import { useDashboardNavigation } from '../../hooks/useDashboardNavigation';
import { useAuth } from '../../context/AuthContext';

import EmployeeVacationStatus from './EmployeeVacationStatus';
import AdminVacationDetails from '../AdminVacationDetails';
import StaffTaskBoard from '../../pages/StaffTaskBoard';
import InlineVacationRequest from '../../components/InlineVacationRequest';
import StaffAttendance from '../../pages/StaffAttendance';
import StaffSeatManagement from '../../pages/StaffSeatManagement';
import StaffBeverageManagement from '../../pages/StaffBeverageManagement';
import StaffBeverageOrderList from '../../pages/StaffBeverageOrderList';
import StaffBeverageServingSheet from '../../pages/StaffBeverageServingSheet';
import StaffNewHireSchedule from '../../pages/StaffNewHireSchedule';
import StaffNewBeverageRequestList from '../../pages/StaffNewBeverageRequestList';
import InlineSideDishRequest from '../InlineSideDishRequest';

const StaffGridMenu = () => {
    const { currentView, navigateTo, goBack } = useDashboardNavigation('grid');
    const { user } = useAuth();
    const [selectedMember, setSelectedMember] = useState(null);
    const isAdmin = user?.role === 'admin';

    // Helper to wrap content with padding
    const renderWithPadding = (component) => (
        <div style={{ height: '100%', padding: '20px', overflowY: 'auto' }}>
            {component}
        </div>
    );

    // Sub-views
    if (currentView === 'employee_vacation') {
        // If a member is selected (admin only), show their vacation details
        if (selectedMember && isAdmin) {
            return renderWithPadding(
                <AdminVacationDetails
                    user={selectedMember}
                    onBack={() => setSelectedMember(null)}
                />
            );
        }

        // Admin: click shows member details, Staff: no interaction
        const handleUserClick = isAdmin ? (memberData) => {
            setSelectedMember({
                id: memberData.id,
                name: memberData.name,
                branch: memberData.branch
            });
        } : undefined;

        return renderWithPadding(
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                    <button onClick={goBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', display: 'flex', alignItems: 'center' }}>
                        <ChevronLeft size={24} color="#2d3748" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>일별 사원 휴무 현황</h3>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    <EmployeeVacationStatus onUserClick={handleUserClick} />
                </div>
            </div>
        );
    }
    if (currentView === 'work_status') {
        return renderWithPadding(
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                    <button onClick={goBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', display: 'flex', alignItems: 'center' }}>
                        <ChevronLeft size={24} color="#2d3748" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>스탭 업무 현황</h3>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    <StaffTaskBoard />
                </div>
            </div>
        );
    }
    if (currentView === 'vacation_request') {
        return renderWithPadding(
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                    <button onClick={goBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', display: 'flex', alignItems: 'center' }}>
                        <ChevronLeft size={24} color="#2d3748" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>스탭 휴무 신청</h3>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    <InlineVacationRequest />
                </div>
            </div>
        );
    }
    if (currentView === 'side_dish_request') {
        return renderWithPadding(
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                    <button onClick={goBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px 0 0', display: 'flex', alignItems: 'center' }}>
                        <ChevronLeft size={24} color="#2d3748" />
                    </button>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>반찬 신청</h3>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    <InlineSideDishRequest />
                </div>
            </div>
        );
    }
    if (currentView === 'attendance') return renderWithPadding(<StaffDailyAttendance onBack={goBack} />);
    if (currentView === 'seat_management') return renderWithPadding(<StaffSeatManagement onBack={goBack} />);
    if (currentView === 'beverage_management') return renderWithPadding(<StaffBeverageManagement onBack={goBack} />);
    if (currentView === 'new_beverage_request_list') return renderWithPadding(<StaffNewBeverageRequestList onBack={goBack} />);
    if (currentView === 'beverage_order_list') return renderWithPadding(<StaffBeverageOrderList onBack={goBack} />);
    if (currentView === 'beverage_serving_sheet') return renderWithPadding(<StaffBeverageServingSheet onBack={goBack} />);
    if (currentView === 'new_hire_schedule') return renderWithPadding(<StaffNewHireSchedule onBack={goBack} />);

    // Grid View (Categorized Structure)
    return (
        <div style={{
            height: '100%',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            overflowY: 'auto'
        }}>
            {/* Section 1: Work Related */}
            <div>
                <h3 style={sectionHeaderStyle}>업무 관련 메뉴</h3>
                <div style={sectionGridStyle}>
                    {/* 1. 일별 사원 휴무 현황 */}
                    <button onClick={() => navigateTo('employee_vacation')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#fff5f5', color: '#c53030' }}>
                            <Calendar size={24} />
                        </div>
                        <span style={{ ...labelStyle, lineHeight: '1.2' }}>일별 사원<br />휴무 현황</span>
                    </button>

                    {/* 2. 음료 제조표 */}
                    <button onClick={() => navigateTo('beverage_order_list')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#e6fffa', color: '#319795' }}>
                            <ClipboardList size={24} />
                        </div>
                        <span style={labelStyle}>음료 제조표</span>
                    </button>

                    {/* 3. 음료 서빙표 (New) */}
                    <button onClick={() => navigateTo('beverage_serving_sheet')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#f0fff4', color: '#2f855a' }}>
                            <Coffee size={24} />
                        </div>
                        <span style={labelStyle}>음료 서빙표</span>
                    </button>

                    <button onClick={() => navigateTo('new_hire_schedule')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#fffaf0', color: '#d69e2e' }}>
                            <UserCheck size={24} />
                        </div>
                        <span style={{ ...labelStyle, lineHeight: '1.2' }}>신규 출근<br />일정</span>
                    </button>
                </div>
            </div>

            <div style={dividerStyle} />

            {/* Section 2: Member Info Related */}
            <div>
                <h3 style={sectionHeaderStyle}>사원 정보 관련 메뉴</h3>
                <div style={sectionGridStyle}>
                    {/* 1. 사원 좌석 관리 */}
                    <button onClick={() => navigateTo('seat_management')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#faf5ff', color: '#805ad5' }}>
                            <MapPin size={24} />
                        </div>
                        <span style={{ ...labelStyle, lineHeight: '1.2' }}>사원<br />좌석 관리</span>
                    </button>

                    {/* 2. 사원 음료 관리 */}
                    <button onClick={() => navigateTo('beverage_management')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#e6fffa', color: '#2c7a7b' }}>
                            <Coffee size={24} />
                        </div>
                        <span style={{ ...labelStyle, lineHeight: '1.2' }}>사원<br />음료 관리</span>
                    </button>

                    <button onClick={() => navigateTo('new_beverage_request_list')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#ebf8ff', color: '#2b6cb0' }}>
                            <ClipboardList size={24} />
                        </div>
                        <span style={{ ...labelStyle, lineHeight: '1.2' }}>새로운 음료<br />신청</span>
                    </button>
                </div>
            </div>

            <div style={dividerStyle} />

            {/* Section 3: Staff Personal */}
            <div>
                <h3 style={sectionHeaderStyle}>스탭 개인 메뉴</h3>
                <div style={sectionGridStyle}>
                    {/* 1. 스탭 휴무 신청 */}
                    <button onClick={() => navigateTo('vacation_request')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#e6fffa', color: '#2c7a7b' }}>
                            <UserPlus size={24} />
                        </div>
                        <span style={{ ...labelStyle, lineHeight: '1.2' }}>스탭<br />휴무 신청</span>
                    </button>

                    <button onClick={() => navigateTo('side_dish_request')} style={menuButtonStyle}>
                        <div style={{ ...iconContainerStyle, background: '#fff7ed', color: '#c05621' }}>
                            <ClipboardList size={24} />
                        </div>
                        <span style={{ ...labelStyle, lineHeight: '1.2' }}>반찬<br />신청</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const menuButtonStyle = {
    aspectRatio: '1',
    borderRadius: '16px',
    border: 'none',
    background: '#f7fafc',
    color: '#2d3748',
    fontSize: '0.95rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
};

const iconContainerStyle = {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '5px'
};

const labelStyle = {
    textAlign: 'center',
    wordBreak: 'keep-all',
    fontSize: '0.9rem'
};

const sectionHeaderStyle = {
    fontSize: '1.1rem',
    fontWeight: 'bold',
    color: '#2c7a7b', // Teal color
    marginBottom: '15px',
    paddingLeft: '5px'
};

const sectionGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
    gap: '15px',
    alignContent: 'start'
};

const dividerStyle = {
    height: '1px',
    backgroundColor: '#e2e8f0',
    margin: '10px 0'
};
export default StaffGridMenu;
