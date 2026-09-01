import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Camera, RefreshCw, Save, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../lib/supabase'

export default function BiometricFaceEnrollment({ empleadoId, clienteId, onEnrollmentSuccess }) {
  const [stream, setStream] = useState(null)
  const [photoData, setPhotoData] = useState(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [hasTemplate, setHasTemplate] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    checkExistingTemplate()
    return () => stopCamera()
  }, [empleadoId])

  const checkExistingTemplate = async () => {
    if (!empleadoId) return
    const { data, error } = await supabase
      .from('biometric_templates')
      .select('id')
      .eq('empleado_id', empleadoId)
      .eq('tipo', 'rostro')
      .maybeSingle()
    if (data) setHasTemplate(true)
  }

  const startCamera = async () => {
    try {
      setIsCapturing(true)
      setPhotoData(null)
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
    } catch (err) {
      toast.error('No se pudo acceder a la cámara')
      setIsCapturing(false)
    }
  }

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setStream(null)
    }
    setIsCapturing(false)
  }, [stream])

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    
    // Obtener en Base64 JPEG
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    setPhotoData(dataUrl)
    stopCamera()
  }

  const saveFaceTemplate = async () => {
    if (!photoData || !empleadoId) return
    setIsSaving(true)
    try {
      const base64Data = photoData.split(',')[1] // Quitar data:image/jpeg;base64,
      
      const payload = {
        cliente_id: clienteId,
        empleado_id: empleadoId,
        tipo: 'rostro',
        indice: 0,
        template_data: base64Data
      }

      // Upsert (Insert o Update si ya existe)
      const { error } = await supabase
        .from('biometric_templates')
        .upsert(payload, { onConflict: 'empleado_id,tipo,indice' })

      if (error) throw error

      toast.success('Rostro enrolado correctamente')
      setHasTemplate(true)
      if (onEnrollmentSuccess) onEnrollmentSuccess()
      setPhotoData(null)
    } catch (err) {
      toast.error('Error al guardar rostro: ' + err.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-slate-50 dark:bg-[#24303f] border border-slate-200 dark:border-[#2e3a4e] rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Camera className="w-4 h-4 text-indigo-500" />
          Enrolamiento Facial
        </h4>
        {hasTemplate && (
          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Registrado
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-4">
        {/* Visualizador de Cámara o Foto Capturada */}
        <div className="relative w-48 h-48 bg-black rounded-full overflow-hidden border-4 border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-inner">
          {!isCapturing && !photoData && (
            <div className="text-slate-400 text-center text-xs px-4">
              <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
              Ninguna foto capturada
            </div>
          )}
          
          {isCapturing && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
            />
          )}

          {photoData && (
            <img 
              src={photoData} 
              alt="Rostro capturado" 
              className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
            />
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Controles */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!isCapturing && !photoData && (
            <button
              onClick={startCamera}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 shadow-md shadow-indigo-500/20"
            >
              <Camera className="w-4 h-4" /> Activar Cámara
            </button>
          )}

          {isCapturing && (
            <>
              <button
                onClick={capturePhoto}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 shadow-md shadow-emerald-500/20"
              >
                Capturar Foto
              </button>
              <button
                onClick={stopCamera}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white text-xs font-bold rounded-lg transition-colors"
              >
                Cancelar
              </button>
            </>
          )}

          {photoData && (
            <>
              <button
                onClick={startCamera}
                disabled={isSaving}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" /> Repetir
              </button>
              <button
                onClick={saveFaceTemplate}
                disabled={isSaving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 shadow-md shadow-indigo-500/20 disabled:opacity-50"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 
                {isSaving ? 'Guardando...' : 'Guardar Rostro'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
