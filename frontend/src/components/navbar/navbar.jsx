import React from "react";
import { isOnPhone } from "../../common/functions";
import NavbarPC from "./responsive/NavbarPC";
import NavbarTelefono from "./responsive/NavbarTelefono";



const Navbar = ({ visible, setVisible }) => {
    
    return (
        isOnPhone ?
        <NavbarTelefono setVisible={setVisible} visible={visible} />
        :
        <NavbarPC visible={visible} setVisible={setVisible} />
    )

};

export default Navbar;
