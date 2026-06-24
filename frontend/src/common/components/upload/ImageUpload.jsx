// src/components/common/ImageUpload.jsx
import React, { useState } from "react";
import { FileUpload } from "primereact/fileupload";
import { ProgressSpinner } from "primereact/progressspinner";
import axios from "axios";
import { useToast } from "../../../context/ToastContext";
import { config } from "../../../config/config";
import nofoto from '../../../assets/img/profile.png';
import noimage from '../../../assets/img/noimage.png';

/**
 * ImageUpload
 * -----------
 * Sube UNA imagen, muestra un spinner mientras sube
 * y avisa al componente padre con el link y la key de S3.
 *
 * Props
 *  - link           URL actual de la imagen (string)
 *  - setLink        (link:string) => void       ✔ obligatorio
 *  - fileKey        clave interna para resetear FileUpload (number)
 *  - setFileKey     (n:number) => void          ✔ obligatorio
 *  - setS3Key       (key:string) => void        ✔ obligatorio, para borrar luego
 *  - uploadUrl      endpoint de subida (string) (/api/archivos por defecto)
 *  - extraFields    obj con campos extra p/ formData (ej. { idEmpleado: 5 })
 *  - accept         tipos MIME permitidos (default "image/*")
 *  - maxFileSize    en bytes (default 10 MB)
 *  - overlayText    texto del overlay ("Cambiar foto")
 *  - className      clases extra para el wrapper
 *  - tipo           'avatar' | 'documento'…    para elegir placeholder
 */
export default function ImageUpload({
  link,
  setLink,
  fileKey,
  setFileKey,
  setS3Key,
  uploadUrl = `${config.backendUrl}/api/archivos`,
  extraFields = {},
  accept = "image/*",
  maxFileSize = 10 * 1024 * 1024,
  overlayText = "Subir",
  className = "",
  tipo = 'avatar',
}) {
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  const uploadHandler = async ({ files }) => {
    const file = files?.[0];
    if (!file) return;

    try {
      setLoading(true);

      const fd = new FormData();
      fd.append("files", file);
      Object.entries(extraFields)
        .forEach(([k, v]) => fd.append(k, v));

      const { data } = await axios.post(uploadUrl, fd, {
        headers: config.headers,
      });
      // adaptamos al shape de tu backend: asumimos que devuelve un array con { url, key }
      const saved = Array.isArray(data) ? data[0] : data;
      const url = saved.url ?? saved.firma ?? saved.fileLink;
      const key = saved.key;

      showToast("success", "Imagen subida correctamente");
      setFileKey(k => k + 1);
      setLink(url);
      setS3Key(key);
    } catch (err) {
      console.error(err);
      showToast("error", "", "Error al subir imagen. Sólo formatos válidos.");
    } finally {
      setLoading(false);
    }
  };

  const avatarTemplate = (
    <div className="flex justify-content-center align-items-center w-full">
      {loading ? (
        <div className="avatar-container p-3">
          <ProgressSpinner style={{ width: "58px", height: "58px" }}
            strokeWidth="6"
            animationDuration=".6s" />
        </div>
      ) : (
        <div className="avatar-container cursor-pointer">
          <img
            src={link || (tipo === 'avatar' ? nofoto : noimage)}
            alt="preview"
            className="avatar-image"
          />
          <div className="avatar-overlay">
            <i className="fa-solid fa-upload mr-2" /> {overlayText}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`image-upload ${className}`} id="fileuploader-image">
      <FileUpload
        key={fileKey}
        name="files"
        mode="basic"

        accept={accept}
        maxFileSize={maxFileSize}
        customUpload
        uploadHandler={uploadHandler}
        auto
        chooseLabel={avatarTemplate}
        chooseOptions={{ className: "profile-uploaded" }}
      />
    </div>
  );
}
