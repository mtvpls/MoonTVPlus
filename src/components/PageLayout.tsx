import { BackButton } from './BackButton';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UpdateNotification } from './UpdateNotification';
import { UserMenu } from './UserMenu';
import { VersionCheckProvider } from './VersionCheckProvider';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  hideNavigation?: boolean; // 控制是否隐藏顶部和底部导航栏
}

const PageLayout = ({
  children,
  activePath = '/',
  hideNavigation = false,
}: PageLayoutProps) => {
  return (
    <VersionCheckProvider>
      <div className='w-full min-h-screen'>
        {/* 移动端头部 */}
        {!hideNavigation && (
          <MobileHeader
            showBackButton={['/play', '/live'].includes(activePath)}
          />
        )}

        {/* 主要布局容器 */}
        <div className='flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
          {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
          {!hideNavigation && (
            <div className='hidden md:block'>
              <Sidebar activePath={activePath} />
            </div>
          )}

          {/* 主内容区域 */}
          <div className='relative min-w-0 flex-1 transition-all duration-300'>
            {/* 桌面端左上角返回按钮 */}
            {!hideNavigation && ['/play', '/live'].includes(activePath) && (
              <div className='absolute top-3 left-1 z-20 hidden md:flex'>
                <BackButton />
              </div>
            )}

            {/* 桌面端顶部按钮 */}
            {!hideNavigation && (
              <div className='absolute top-2 right-4 z-20 hidden md:flex items-center gap-2'>
                <ThemeToggle />
                <UserMenu />
                <UpdateNotification />
              </div>
            )}

            {/* 主内容 */}
            <main
              className='flex-1 md:min-h-0 mb-14 md:mb-0 md:mt-0 mt-12'
              style={{
                paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
              }}
            >
              {children}
            </main>
          </div>
        </div>

        {/* 移动端底部导航 */}
        {!hideNavigation && (
          <div className='md:hidden'>
            <MobileBottomNav activePath={activePath} />
          </div>
        )}
      </div>
    </VersionCheckProvider>
  );
};

export default PageLayout;
