import React from "react";

const NonPerm = () => {
    return (
        <div className="w-full h-full flex flex-column align-items-center justify-content-center text-center">
            <i className="fa-solid fa-ban" style={{fontSize: '3rem', color: 'var(--red-400)'}}></i>
            <h2>No tenés permisos para ver esta página</h2>
            
        </div>
    )
}
export default NonPerm;