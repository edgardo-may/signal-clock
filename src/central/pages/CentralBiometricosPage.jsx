// src/central/pages/CentralBiometricosPage.jsx — Módulo de Biométricos Completo para Signum-Clock Central
import BiometricosPage from '../../features/biometrics/pages/BiometricosPage'

export default function CentralBiometricosPage({ forcedSubview }) {
  return <BiometricosPage layout="central" forcedSubview={forcedSubview} />
}
