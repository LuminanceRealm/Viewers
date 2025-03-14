import React from 'react';
import type { IconProps } from '../types';

export const Alert = (props: IconProps) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g
      fill="none"
      fillRule="evenodd"
    >
      <path
        d="M24 11.794c.017 6.667-5.333 12.108-12 12.205a11.823 11.823 0 0 1-12-11.79C-.019 5.541 5.331.1 12 .001a11.824 11.824 0 0 1 12 11.793z"
        fill="#B70D11"
      />
      <g
        stroke="#FFF"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M11.494 17.158a.245.245 0 0 0-.241.255.254.254 0 0 0 .253.245h0a.246.246 0 0 0 .241-.255.253.253 0 0 0-.244-.245h-.005M11.503 13V6" />
      </g>
    </g>
  </svg>
);

export default Alert;
