import clsx from 'clsx';

type PrivoxLogoProps = {
  className?: string;
  markClassName?: string;
  showSignal?: boolean;
};

export function PrivoxLogo({ className, markClassName }: PrivoxLogoProps) {
  return (
    <span className={clsx('inline-flex items-center justify-center overflow-hidden rounded-lg bg-[#101820]', className)}>
      <img
        src="/icons/icon-192.png"
        alt=""
        aria-hidden="true"
        className={clsx('h-full w-full object-cover', markClassName)}
      />
    </span>
  );
}
